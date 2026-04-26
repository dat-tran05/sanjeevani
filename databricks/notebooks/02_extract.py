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
SUBSET_FILTER = "state = 'Bihar'"
SUBSET_LIMIT = 100

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
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(todo)} done")
    except Exception as e:
        print(f"  FAIL {row.facility_id}: {type(e).__name__}: {e}")
        failures.append((row.facility_id, str(e)))

print(f"\nExtracted: {len(extracted_records)}, Failed: {len(failures)}")

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

# COMMAND ----------

# Sanity check: pick one Bihar row
display(spark.sql(f"""
    SELECT p.name, p.state, p.city, e.surgery_capable, e.emergency_24_7,
           e.explicit_capabilities, e.staff_mentioned
    FROM {CATALOG}.silver.facilities_extracted e
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    WHERE p.state = 'Bihar'
    LIMIT 5
"""))
