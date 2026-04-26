# Databricks notebook source
# MAGIC %md
# MAGIC # 07 — Tiebreaker (Sonnet 4.6 extended thinking)
# MAGIC For each split claim in `gold.trust_verdicts`, call Sonnet 4.6 with extended thinking
# MAGIC budget=3000 to produce a final verdict + rationale. Writes `gold.tiebreaker_verdicts`.
# MAGIC Idempotent on claim_id.

# COMMAND ----------

# MAGIC %pip install anthropic tenacity
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CATALOG = "sanjeevani"
TIEBREAKER_MODEL = "us.anthropic.claude-sonnet-4-6"
THINKING_BUDGET = 3000

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.tiebreaker_verdicts (
        claim_id STRING,
        model STRING,
        final_verdict STRING,
        rationale STRING,
        created_at TIMESTAMP
    ) USING DELTA
""")

# Find split claims (any claim where judges don't all agree)
splits = spark.sql(f"""
    WITH agg AS (
        SELECT claim_id,
               SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS supp,
               SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS part,
               SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns
        FROM {CATALOG}.gold.trust_verdicts
        GROUP BY claim_id
    )
    SELECT c.claim_id, c.claim_text, c.facility_id, p.name, p.description,
           agg.supp, agg.part, agg.uns
    FROM {CATALOG}.silver.facility_claims c
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    JOIN agg USING (claim_id)
    LEFT ANTI JOIN {CATALOG}.gold.tiebreaker_verdicts t USING (claim_id)
    WHERE NOT (agg.supp = 3 OR agg.uns = 3 OR agg.part = 3)
""").collect()

print(f"Split claims to tiebreak: {len(splits)}")

# COMMAND ----------

import os
import json
from datetime import datetime, timezone
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

AWS_BEARER_TOKEN_BEDROCK = dbutils.secrets.get(scope="sanjeevani", key="AWS_BEARER_TOKEN_BEDROCK")
os.environ["AWS_BEARER_TOKEN_BEDROCK"] = AWS_BEARER_TOKEN_BEDROCK
os.environ["AWS_REGION"] = "us-east-1"
client = anthropic.AnthropicBedrock(aws_region="us-east-1")


TIEBREAKER_PROMPT = """Three judges have given conflicting verdicts on a healthcare facility's claim. Resolve the disagreement.

CLAIM: "{claim_text}"
FACILITY: {name}
SOURCE TEXT:
\"\"\"
{description}
\"\"\"

JUDGE TALLY: {supp} supported, {part} partial, {uns} unsupported.

Use your reasoning to pick the final verdict that best reflects what the source actually supports.
Return JSON only:
{{"final_verdict": "supported"|"partial"|"unsupported",
  "rationale": "<one paragraph explaining your reasoning>"}}"""


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=2, max=30),
       retry=retry_if_exception_type(Exception))
def tiebreak_one(row) -> dict:
    prompt = TIEBREAKER_PROMPT.format(
        claim_text=row.claim_text, name=row.name or "(unknown)",
        description=(row.description or "(none)")[:2000],
        supp=row.supp, part=row.part, uns=row.uns,
    )
    resp = client.messages.create(
        model=TIEBREAKER_MODEL,
        max_tokens=2000,
        thinking={"type": "enabled", "budget_tokens": THINKING_BUDGET},
        messages=[{"role": "user", "content": prompt}],
    )
    # Find the text block (after thinking blocks)
    for block in resp.content:
        if block.type == "text":
            text = block.text.strip()
            break
    else:
        raise ValueError("No text block in response")
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


records = []
for i, row in enumerate(splits):
    try:
        v = tiebreak_one(row)
        records.append({
            "claim_id": row.claim_id,
            "model": TIEBREAKER_MODEL,
            "final_verdict": v.get("final_verdict", "partial"),
            "rationale": v.get("rationale", "")[:2000],
            "created_at": datetime.now(timezone.utc),
        })
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(splits)} done")
    except Exception as e:
        print(f"  FAIL {row.claim_id}: {type(e).__name__}: {e}")

print(f"\nTiebreakers: {len(records)}")

# COMMAND ----------

if records:
    new_df = spark.createDataFrame(records)
    new_df.createOrReplaceTempView("new_tiebreakers")

    spark.sql(f"""
        MERGE INTO {CATALOG}.gold.tiebreaker_verdicts AS target
        USING new_tiebreakers AS source
        ON target.claim_id = source.claim_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total tiebreakers: {spark.table(f'{CATALOG}.gold.tiebreaker_verdicts').count()}")

# COMMAND ----------

display(spark.sql(f"SELECT * FROM {CATALOG}.gold.tiebreaker_verdicts LIMIT 10"))
