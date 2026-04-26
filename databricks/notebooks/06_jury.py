# Install required packages if not already installed
try:
    import anthropic
except ModuleNotFoundError:
    %pip install openai tenacity boto3 anthropic
    dbutils.library.restartPython()

import os
import json
import time
import boto3
from datetime import datetime, timezone
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import anthropic

CATALOG = "sanjeevani"

# Judges (heterogeneous — different vendors)
JUDGES = [
    {"id": "us.anthropic.claude-sonnet-4-6", "vendor": "anthropic", "via": "bedrock"},
    {"id": "databricks-meta-llama-3-3-70b-instruct", "vendor": "meta", "via": "databricks"},
    {"id": "databricks-qwen3-next-80b-a3b-instruct", "vendor": "databricks", "via": "databricks"},
]

# Throttle Free Edition QPS
SLEEP_BETWEEN_CLAIMS = 0.8

# Ensure target table exists (idempotent)
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.trust_verdicts (
        claim_id STRING,
        judge_model STRING,
        judge_vendor STRING,
        verdict STRING,
        confidence FLOAT,
        quote STRING,
        created_at TIMESTAMP
    ) USING DELTA
""")

# Find claims that don't yet have all 3 judges' verdicts
todo = spark.sql(f"""
    WITH expected AS (
        SELECT c.claim_id, j.judge_model
        FROM {CATALOG}.silver.facility_claims c
        CROSS JOIN (
            SELECT 'us.anthropic.claude-sonnet-4-6' AS judge_model
            UNION ALL SELECT 'databricks-meta-llama-3-3-70b-instruct'
            UNION ALL SELECT 'databricks-qwen3-next-80b-a3b-instruct'
        ) j
    )
    SELECT DISTINCT c.claim_id, c.facility_id, c.claim_type, c.claim_text,
           c.char_start, c.char_end,
           p.description, p.name
    FROM {CATALOG}.silver.facility_claims c
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    JOIN expected e ON c.claim_id = e.claim_id
    LEFT ANTI JOIN {CATALOG}.gold.trust_verdicts v
        ON e.claim_id = v.claim_id AND e.judge_model = v.judge_model
""").collect()

# Group rows back per claim (we need one entry per claim, not per missing judge)
claims_by_id = {}
for r in todo:
    claims_by_id.setdefault(r.claim_id, r)

print(f"Claims needing one or more judges: {len(claims_by_id)}")

# Databricks Model Serving client (for Llama, Qwen)
_workspace = spark.conf.get("spark.databricks.workspaceUrl")
_dbrx_token = dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()
dbrx_client = OpenAI(
    api_key=_dbrx_token,
    base_url=f"https://{_workspace}/serving-endpoints",
)

# Bedrock client (for Sonnet judge)
# Set AWS creds in Databricks workspace secret scope `sanjeevani`
AWS_BEARER_TOKEN_BEDROCK = dbutils.secrets.get(scope="sanjeevani", key="AWS_BEARER_TOKEN_BEDROCK")
AWS_REGION = "us-east-1"
os.environ["AWS_BEARER_TOKEN_BEDROCK"] = AWS_BEARER_TOKEN_BEDROCK
os.environ["AWS_REGION"] = AWS_REGION
bedrock_client = anthropic.AnthropicBedrock(aws_region=AWS_REGION)


JURY_PROMPT = """You are an independent fact-verifier judging a healthcare facility's claim.

CLAIM: "{claim_text}"
FACILITY: {facility_name}
SOURCE TEXT (from facility's description):
\"\"\"
{description}
\"\"\"

Your task: decide if the claim is SUPPORTED, PARTIAL, or UNSUPPORTED by the source text alone.

- SUPPORTED: source text directly confirms the claim
- PARTIAL: source text suggests the claim is true but not explicitly
- UNSUPPORTED: source text doesn't back the claim, or contradicts it

Return JSON only:
{{"verdict": "supported"|"partial"|"unsupported",
  "confidence": <0..1>,
  "quote": "<verbatim excerpt from source text that informs your verdict, or empty string>"}}"""


@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    retry=retry_if_exception_type(Exception),
)
def judge_one(judge: dict, claim_row) -> dict:
    prompt = JURY_PROMPT.format(
        claim_text=claim_row.claim_text,
        facility_name=claim_row.name or "(unknown)",
        description=(claim_row.description or "(none)")[:2000],
    )
    if judge["via"] == "bedrock":
        resp = bedrock_client.messages.create(
            model=judge["id"],
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
    else:
        resp = dbrx_client.chat.completions.create(
            model=judge["id"],
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.1,
        )
        text = resp.choices[0].message.content.strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    return {
        "verdict": parsed.get("verdict", "unsupported"),
        "confidence": float(parsed.get("confidence", 0.0)),
        "quote": parsed.get("quote", "")[:500],
    }


verdicts_records = []
failures = []
existing = spark.sql(f"SELECT claim_id, judge_model FROM {CATALOG}.gold.trust_verdicts").collect()
existing_keys = {(r.claim_id, r.judge_model) for r in existing}

claim_ids = list(claims_by_id.keys())
print(f"Processing {len(claim_ids)} claims × {len(JUDGES)} judges = up to {len(claim_ids) * len(JUDGES)} verdicts")

for i, cid in enumerate(claim_ids):
    claim_row = claims_by_id[cid]
    for judge in JUDGES:
        if (cid, judge["id"]) in existing_keys:
            continue
        try:
            v = judge_one(judge, claim_row)
            verdicts_records.append({
                "claim_id": cid,
                "judge_model": judge["id"],
                "judge_vendor": judge["vendor"],
                "verdict": v["verdict"],
                "confidence": v["confidence"],
                "quote": v["quote"],
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as e:
            print(f"  FAIL {cid} / {judge['id']}: {type(e).__name__}: {e}")
            failures.append((cid, judge["id"], str(e)))
    if (i + 1) % 10 == 0:
        print(f"  {i+1}/{len(claim_ids)} claims processed; {len(verdicts_records)} new verdicts; {len(failures)} fails")
    time.sleep(SLEEP_BETWEEN_CLAIMS)

print(f"\nVerdicts: {len(verdicts_records)}, Failed: {len(failures)}")

if verdicts_records:
    new_df = spark.createDataFrame(verdicts_records)
    new_df.createOrReplaceTempView("new_verdicts")

    spark.sql(f"""
        MERGE INTO {CATALOG}.gold.trust_verdicts AS target
        USING new_verdicts AS source
        ON target.claim_id = source.claim_id AND target.judge_model = source.judge_model
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total verdicts: {spark.table(f'{CATALOG}.gold.trust_verdicts').count()}")

# Sanity check: agreement breakdown across claims
display(spark.sql(f"""
    WITH agg AS (
        SELECT claim_id,
               COUNT(*) AS judge_count,
               SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS supported,
               SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial,
               SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS unsupported
        FROM {CATALOG}.gold.trust_verdicts
        GROUP BY claim_id
    )
    SELECT
        SUM(CASE WHEN supported=3 THEN 1 ELSE 0 END) AS three_agree_supported,
        SUM(CASE WHEN supported=2 THEN 1 ELSE 0 END) AS two_supported,
        SUM(CASE WHEN unsupported=3 THEN 1 ELSE 0 END) AS three_agree_unsupported,
        SUM(CASE WHEN supported>=1 AND unsupported>=1 THEN 1 ELSE 0 END) AS split_claims,
        COUNT(*) AS total_claims
    FROM agg
"""))