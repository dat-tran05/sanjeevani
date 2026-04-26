# Databricks notebook source
# MAGIC %md
# MAGIC # 02 — Capability Extraction (Llama 3.3 70B)
# MAGIC Reads `silver.facilities_parsed`, calls Llama 3.3, writes structured capabilities.
# MAGIC Idempotent: skips rows already in `silver.facilities_extracted`.
# MAGIC
# MAGIC Thin slice: filter to `state='Bihar'` and `LIMIT 100`.

# COMMAND ----------

# MAGIC %pip install pydantic openai tenacity
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CATALOG = "sanjeevani"
LLAMA_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct"

# Phase B2 subset: hero-query keyword prefilter (~150 facilities)
SUBSET_FILTER = """(
    (state='Bihar' AND description RLIKE '(?i)(surgery|emergency|operation|theatre|operating)')
    OR (state='Maharashtra' AND city IN ('Mumbai','Thane','Navi Mumbai','New Mumbai')
        AND (description RLIKE '(?i)(oncolog|cancer|radiation|chemo)' OR
             array_contains(specialties, 'oncology')))
    OR (state='Tamil Nadu' AND description RLIKE '(?i)(pediatric|paediatric|PICU|NICU|intensive care|child)')
)"""
SUBSET_LIMIT = 200

# COMMAND ----------

# MAGIC %md ## Step 1: Find rows needing extraction

# COMMAND ----------

# Ensure target table exists with correct schema (idempotent)
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.silver.facilities_extracted (
        facility_id STRING,
        explicit_capabilities ARRAY<STRING>,
        implicit_capabilities ARRAY<STRING>,
        surgery_capable BOOLEAN,
        emergency_24_7 BOOLEAN,
        staff_mentioned ARRAY<STRING>,
        equipment_mentioned ARRAY<STRING>,
        operating_hours_text STRING,
        urgent_care_signals ARRAY<STRING>,
        extracted_at TIMESTAMP,
        extractor_model STRING
    ) USING DELTA
""")

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.silver.facility_claims (
        claim_id STRING,
        facility_id STRING,
        claim_type STRING,
        claim_text STRING,
        source_column STRING,
        char_start INT,
        char_end INT,
        created_at TIMESTAMP
    ) USING DELTA
""")

todo = spark.sql(f"""
    SELECT p.facility_id, p.name, p.description, p.specialties,
           p.procedure_list, p.equipment_list, p.capability_list
    FROM {CATALOG}.silver.facilities_parsed p
    LEFT ANTI JOIN {CATALOG}.silver.facilities_extracted e
        ON p.facility_id = e.facility_id
    WHERE {SUBSET_FILTER}
    LIMIT {SUBSET_LIMIT}
""").collect()

print(f"To extract: {len(todo)} rows")

# COMMAND ----------

# MAGIC %md ## Step 2: Define extraction prompt and structured output schema

# COMMAND ----------

from pydantic import BaseModel, Field
from typing import Optional


class ExtractedCapabilities(BaseModel):
    explicit_capabilities: list[str] = Field(
        description="Capabilities directly stated in the facility's text (e.g., 'performs root canal therapy')."
    )
    implicit_capabilities: list[str] = Field(
        description="Capabilities reasonably inferred from context but not stated directly."
    )
    surgery_capable: bool = Field(
        description="True if the facility text supports the claim that surgery is performed there."
    )
    emergency_24_7: bool = Field(
        description="True if the facility text supports 24/7 emergency availability."
    )
    staff_mentioned: list[str] = Field(
        description="Specific staff types or roles mentioned (e.g., 'anesthesiologist', 'pediatrician')."
    )
    equipment_mentioned: list[str] = Field(
        description="Specific medical equipment mentioned (e.g., 'CT scan', 'ventilator')."
    )
    operating_hours_text: Optional[str] = Field(
        default=None,
        description="A short string describing operating hours if mentioned, else null.",
    )
    urgent_care_signals: list[str] = Field(
        description="Signals indicating urgent/critical care capability (e.g., 'ICU', 'trauma center')."
    )


EXTRACTION_PROMPT = """You are a medical-data extraction system. Given a healthcare facility's unstructured fields, extract structured capability claims.

Read the facility name, description, and pre-tagged lists. Output JSON matching this schema:

{schema}

Rules:
- Only extract what the text actually supports. No hallucination.
- For booleans, default to false unless evidence is explicit.
- For lists, return [] if nothing applicable.
- For operating_hours_text, return null if hours not mentioned.

Facility data:
NAME: {name}
DESCRIPTION: {description}
SPECIALTIES: {specialties}
PROCEDURES: {procedures}
EQUIPMENT: {equipment}
CAPABILITY_NOTES: {capability}

Return ONLY the JSON object, no commentary."""

import re
import hashlib
from datetime import datetime, timezone

# Map claim_type slots to short prefixes for stable claim_ids
CLAIM_TYPE_PREFIX = {
    "emergency_surgery": "es",
    "oncology_specialty": "os",
    "picu": "pi",
    "icu_24_7": "ic",
    "obstetrics": "ob",
    "general_surgery": "gs",
    "specialty_claim": "sp",
    "equipment_claim": "eq",
}


def derive_claims(facility_id: str, extracted: ExtractedCapabilities,
                  description: str | None) -> list[dict]:
    """Generate one row per surfaced capability with stable claim_id and offsets."""
    rows = []
    desc = description or ""
    seen_types = set()

    def add(claim_type: str, claim_text: str, search_terms: list[str]):
        if claim_type in seen_types:
            return
        seen_types.add(claim_type)
        prefix = CLAIM_TYPE_PREFIX.get(claim_type, "ot")
        # facility_id is a long sha; take last 8 hex chars for compactness
        short_id = facility_id[-8:].upper()
        claim_id = f"cap_{prefix}_F-{short_id}"
        # Locate first occurrence of any search term in description (case-insensitive)
        char_start, char_end = -1, -1
        for term in search_terms:
            m = re.search(re.escape(term), desc, re.IGNORECASE)
            if m:
                char_start, char_end = m.start(), m.end()
                break
        rows.append({
            "claim_id": claim_id,
            "facility_id": facility_id,
            "claim_type": claim_type,
            "claim_text": claim_text,
            "source_column": "description",
            "char_start": char_start,
            "char_end": char_end,
            "created_at": datetime.now(timezone.utc),
        })

    if extracted.surgery_capable:
        if extracted.emergency_24_7:
            add("emergency_surgery", "Operates 24/7 emergency surgery",
                ["emergency", "24-hour", "24 hour", "24/7", "around the clock"])
        else:
            add("general_surgery", "Performs general surgery",
                ["surgery", "operation", "operating", "theatre"])
    if extracted.emergency_24_7 and not extracted.surgery_capable:
        add("icu_24_7", "Operates 24/7 emergency / intensive care",
            ["emergency", "24-hour", "24 hour", "24/7", "ICU", "intensive"])
    # Specialty claims from explicit_capabilities array
    for cap in extracted.explicit_capabilities[:3]:
        cap_lower = cap.lower()
        if any(k in cap_lower for k in ["oncolog", "cancer", "radiation", "chemo"]):
            add("oncology_specialty", f"Listed oncology capability: {cap}",
                ["oncolog", "cancer", "radiation", "chemo"])
        elif any(k in cap_lower for k in ["pediatric", "paediatric", "picu", "child", "neonatal"]):
            add("picu", f"Listed pediatric/PICU capability: {cap}",
                ["pediatric", "paediatric", "PICU", "NICU", "child"])
        elif any(k in cap_lower for k in ["obstetric", "maternity", "delivery"]):
            add("obstetrics", f"Listed obstetrics capability: {cap}",
                ["obstetric", "maternity", "delivery"])
    return rows

# COMMAND ----------

# MAGIC %md ## Step 3: Run extraction with retries

# COMMAND ----------

import os
import json
from datetime import datetime, timezone
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# Databricks notebook gets host/token automatically. workspaceUrl is returned
# without protocol (e.g. "dbc-xxxx.cloud.databricks.com"), so we prepend https://.
_workspace = spark.conf.get("spark.databricks.workspaceUrl")
client = OpenAI(
    api_key=dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get(),
    base_url=f"https://{_workspace}/serving-endpoints",
)

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=1, max=10),
    retry=retry_if_exception_type(Exception),
)
def extract_one(row) -> ExtractedCapabilities:
    prompt = EXTRACTION_PROMPT.format(
        schema=json.dumps(ExtractedCapabilities.model_json_schema(), indent=2),
        name=row.name,
        description=row.description or "(none)",
        specialties=row.specialties or [],
        procedures=row.procedure_list or [],
        equipment=row.equipment_list or [],
        capability=row.capability_list or [],
    )
    resp = client.chat.completions.create(
        model=LLAMA_ENDPOINT,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=800,
        temperature=0.1,
    )
    text = resp.choices[0].message.content.strip()
    # strip ``` fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return ExtractedCapabilities.model_validate_json(text)


extracted_records = []
claims_records = []
failures = []
for i, row in enumerate(todo):
    try:
        result = extract_one(row)
        extracted_records.append({
            "facility_id": row.facility_id,
            **result.model_dump(),
            "extracted_at": datetime.now(timezone.utc),
            "extractor_model": "llama-3-3-70b",
        })
        for c in derive_claims(row.facility_id, result, row.description):
            claims_records.append(c)
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(todo)} done ({len(claims_records)} claims so far)")
    except Exception as e:
        print(f"  FAIL {row.facility_id}: {type(e).__name__}: {e}")
        failures.append((row.facility_id, str(e)))

print(f"\nExtracted: {len(extracted_records)}, Claims: {len(claims_records)}, Failed: {len(failures)}")

# COMMAND ----------

# MAGIC %md ## Step 4: MERGE into silver.facilities_extracted

# COMMAND ----------

if extracted_records:
    new_df = spark.createDataFrame(extracted_records)
    new_df.createOrReplaceTempView("new_extractions")

    spark.sql(f"""
        MERGE INTO {CATALOG}.silver.facilities_extracted AS target
        USING new_extractions AS source
        ON target.facility_id = source.facility_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total in table: {spark.table(f'{CATALOG}.silver.facilities_extracted').count()}")

if claims_records:
    claims_df = spark.createDataFrame(claims_records)
    claims_df.createOrReplaceTempView("new_claims")

    spark.sql(f"""
        MERGE INTO {CATALOG}.silver.facility_claims AS target
        USING new_claims AS source
        ON target.claim_id = source.claim_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"Claims MERGE complete. Total in table: {spark.table(f'{CATALOG}.silver.facility_claims').count()}")

# COMMAND ----------

# Sanity check
display(spark.sql(f"""
    SELECT p.name, p.state, p.city, e.surgery_capable, e.emergency_24_7,
           e.explicit_capabilities, e.staff_mentioned
    FROM {CATALOG}.silver.facilities_extracted e
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    LIMIT 10
"""))

display(spark.sql(f"""
    SELECT claim_id, facility_id, claim_type, claim_text, char_start, char_end
    FROM {CATALOG}.silver.facility_claims
    LIMIT 10
"""))
