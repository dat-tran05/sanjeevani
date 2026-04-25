# Phase A1+B1 Thin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working end-to-end demo of hero query #1 ("rural Bihar emergency appendectomy") in 2 hours — real Delta tables, real Bedrock, real Llama, real SSE streaming through a Next.js chat UI.

**Architecture:** Track A produces minimal Delta tables (Bronze/Silver/Gold) on Databricks Free Edition; Track B produces FastAPI + LangGraph backend and Next.js 16 frontend that talk to those tables. Joint kickoff locks the schema; parallel build; joint integration test at end.

**Tech Stack:** Databricks (Delta + Unity Catalog + Foundation Model API + Model Serving), AWS Bedrock (Claude Sonnet 4.6), FastAPI, LangGraph 1.0, MLflow 3, Next.js 16.2 App Router, TypeScript, shadcn/ui, Tailwind, custom SSE.

**Team split:**
- **Person A** (Track A — Databricks notebooks): Tasks 1-3 (joint), then 4-6 (alone)
- **Person B** (Track B — local app stack): Tasks 1-3 (joint), then 7-12 (alone)
- **Both**: Tasks 13-14 (joint integration)

**Time budget per phase:**
- Joint kickoff (Tasks 1-3): 30 minutes
- Parallel build: 1 hour 15 minutes
- Joint integration (Tasks 13-14): 15 minutes

**Planned deviations from spec (`2026-04-25-sanjeevani-build-plan-design.md`):**
- **District mapping deferred** — Spec §5 A1 DoD requires `district IS NOT NULL` for ≥9,800 rows. The thin slice writes `district = NULL` and uses a top-30-cities heuristic for `is_rural`/`is_urban` only. Full pincode→district mapping is a follow-up task in the next plan (post-H+2). The Q1 hero query needs `state` + `is_rural`, not district.
- **Hybrid retrieval simplified to dense-only** — Spec §6 B2 lists BM25 + dense + RRF. The thin slice uses only dense (NumPy cosine on `gold.facility_embeddings`). BM25 + RRF arrive in the next phase plan; the agent retriever node is structured to accept the upgrade.
- **Single-proposer answer node** — Spec §6 B7 covers the MoA upgrade. Thin slice is single-proposer (Sonnet 4.6) by design (matches spec §1: "minimal UI" thin slice).

---

## Task 1: Initialize Repo Structure and Env Files (Joint, Person A leads)

**Files:**
- Create: `databricks/notebooks/.gitkeep`
- Create: `databricks/lib/.gitkeep`
- Create: `backend/.gitkeep`
- Create: `frontend/.gitkeep`
- Create: `scripts/.gitkeep`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create directory skeleton**

```bash
mkdir -p databricks/notebooks databricks/lib backend frontend scripts
touch databricks/notebooks/.gitkeep databricks/lib/.gitkeep backend/.gitkeep frontend/.gitkeep scripts/.gitkeep
```

- [ ] **Step 2: Create `.env.example` at repo root**

```bash
cat > .env.example <<'EOF'
# AWS Bedrock — Anthropic models
AWS_BEARER_TOKEN_BEDROCK=<paste-bedrock-bearer-token>
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6
BEDROCK_MODEL_ID_HAIKU=us.anthropic.claude-haiku-4-5

# Databricks workspace
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<personal-access-token>
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<warehouse-id>
DATABRICKS_LLAMA_ENDPOINT=databricks-meta-llama-3-3-70b-instruct
DATABRICKS_QWEN_ENDPOINT=databricks-qwen3-next-80b-a3b-instruct
DATABRICKS_EMBEDDING_ENDPOINT=databricks-gte-large-en
DATABRICKS_GENIE_SPACE_ID=<space-id>

# Unity Catalog
UC_CATALOG=sanjeevani

# MLflow tracing
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_NAME=/Users/<user>/sanjeevani-traces

# Local app
FASTAPI_PORT=8000
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
```

- [ ] **Step 3: Update `.gitignore`**

Append to existing `.gitignore`:
```bash
cat >> .gitignore <<'EOF'

# Python
__pycache__/
*.pyc
.venv/
backend/.venv/
backend/.env
*.egg-info/

# Node
node_modules/
.next/
frontend/.env.local
frontend/.env

# Env
.env

# Databricks notebook artifacts
.ipynb_checkpoints/
*_databricks_artifacts/

# OS
.DS_Store
EOF
```

- [ ] **Step 4: Each person creates their own `.env` from `.env.example`**

Person A and Person B each:
```bash
cp .env.example .env
# Fill in actual values for their use case
```

**STOP HERE — paste real env values into `.env`** (Bedrock token, Databricks token, Workspace URL, SQL Warehouse path). The remaining tasks will fail without these.

- [ ] **Step 5: Commit scaffold**

```bash
git add .env.example .gitignore databricks/ backend/ frontend/ scripts/
git commit -m "chore: scaffold repo directories and env example"
```

---

## Task 2: Sanity-Check Connections (Joint)

**Files:**
- Create: `scripts/sanity_check.py`

Verify Bedrock, Databricks SQL, and Databricks Model Serving all work before writing real code. Catches auth/network problems early.

- [ ] **Step 1: Create `scripts/sanity_check.py`**

```python
"""Run from repo root: `python scripts/sanity_check.py`. All three checks must pass."""
import os
import sys
from pathlib import Path

# Load .env
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")


def check_bedrock() -> bool:
    """Verify Bedrock credentials and Sonnet 4.6 invocation."""
    print("[1/3] Bedrock + Claude Sonnet 4.6...", end=" ", flush=True)
    try:
        from anthropic import AnthropicBedrock
        client = AnthropicBedrock(
            aws_region=os.environ["AWS_REGION"],
        )
        resp = client.messages.create(
            model=os.environ["BEDROCK_MODEL_ID"],
            max_tokens=20,
            messages=[{"role": "user", "content": "Reply with exactly: PONG"}],
        )
        text = resp.content[0].text.strip()
        if "PONG" in text:
            print(f"OK ({text!r})")
            return True
        print(f"FAIL — unexpected response: {text!r}")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


def check_databricks_sql() -> bool:
    """Verify Databricks SQL Warehouse connection."""
    print("[2/3] Databricks SQL Warehouse...", end=" ", flush=True)
    try:
        from databricks import sql
        with sql.connect(
            server_hostname=os.environ["DATABRICKS_HOST"].replace("https://", ""),
            http_path=os.environ["DATABRICKS_HTTP_PATH"],
            access_token=os.environ["DATABRICKS_TOKEN"],
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ping")
                row = cur.fetchone()
                if row[0] == 1:
                    print("OK")
                    return True
        print("FAIL — unexpected result")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


def check_databricks_serving() -> bool:
    """Verify Llama 3.3 endpoint via OpenAI-compatible API."""
    print("[3/3] Databricks Model Serving (Llama 3.3)...", end=" ", flush=True)
    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.environ["DATABRICKS_TOKEN"],
            base_url=f"{os.environ['DATABRICKS_HOST']}/serving-endpoints",
        )
        resp = client.chat.completions.create(
            model=os.environ["DATABRICKS_LLAMA_ENDPOINT"],
            messages=[{"role": "user", "content": "Reply with exactly: PONG"}],
            max_tokens=20,
        )
        text = resp.choices[0].message.content.strip()
        if "PONG" in text:
            print(f"OK ({text!r})")
            return True
        print(f"FAIL — unexpected response: {text!r}")
        return False
    except Exception as e:
        print(f"FAIL — {type(e).__name__}: {e}")
        return False


if __name__ == "__main__":
    results = [check_bedrock(), check_databricks_sql(), check_databricks_serving()]
    if not all(results):
        print("\n❌ Some checks failed. Fix before proceeding.")
        sys.exit(1)
    print("\n✅ All connections healthy. Ready to build.")
```

- [ ] **Step 2: Install dependencies for the sanity script**

```bash
python -m venv .venv-sanity
source .venv-sanity/bin/activate
pip install python-dotenv anthropic[bedrock] databricks-sql-connector openai
```

- [ ] **Step 3: Run sanity check**

```bash
python scripts/sanity_check.py
```

Expected output:
```
[1/3] Bedrock + Claude Sonnet 4.6... OK ('PONG')
[2/3] Databricks SQL Warehouse... OK
[3/3] Databricks Model Serving (Llama 3.3)... OK ('PONG')

✅ All connections healthy. Ready to build.
```

If any FAIL: stop and resolve before continuing. Common fixes:
- Bedrock 403 → bearer token wrong or AWS_REGION mismatch
- Databricks SQL → warehouse asleep, run again to wake it
- Model Serving → check endpoint name matches workspace exactly

- [ ] **Step 4: Commit**

```bash
git add scripts/sanity_check.py
git commit -m "chore: add connection sanity check script"
```

---

## Task 3: Create Unity Catalog Schemas (Joint, Person A executes in Databricks)

**Files:**
- Create: `databricks/notebooks/00_setup_uc.py`

Run in a Databricks notebook to create the catalog/schemas all subsequent notebooks expect.

- [ ] **Step 1: Create `databricks/notebooks/00_setup_uc.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 00 — Unity Catalog Setup
# MAGIC Creates `sanjeevani.{bronze,silver,gold}` schemas. Idempotent.

# COMMAND ----------

CATALOG = "sanjeevani"
SCHEMAS = ["bronze", "silver", "gold"]

spark.sql(f"CREATE CATALOG IF NOT EXISTS {CATALOG}")
for s in SCHEMAS:
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{s}")

# COMMAND ----------

# Sanity: list schemas
display(spark.sql(f"SHOW SCHEMAS IN {CATALOG}"))
```

- [ ] **Step 2: Person A runs the notebook in Databricks**

Open Databricks workspace → Workspace → Import notebook → upload `00_setup_uc.py` (or paste contents). Run all cells. Output should show three rows: `bronze`, `silver`, `gold`.

- [ ] **Step 3: Commit**

```bash
git add databricks/notebooks/00_setup_uc.py
git commit -m "feat(databricks): add UC catalog and schema setup notebook"
```

---

# Track A — Person A (alone, H0.5-H2)

## Task 4: Notebook 01 — Bronze + Silver Layers

**Files:**
- Create: `databricks/notebooks/01_bronze_silver.py`
- Create: `databricks/lib/parsers.py` (helper used by notebook)
- Create: `databricks/tests/test_parsers.py`

Loads CSV → Bronze, parses + normalizes → Silver. All 10k rows. Idempotent (uses `MERGE INTO` keyed on synthetic `facility_id`).

- [ ] **Step 1: Create `databricks/lib/parsers.py`**

```python
"""Pure functions to parse and normalize CSV rows. Tested in isolation."""
from __future__ import annotations

import json
from typing import Any

# Indian states/UTs canonical spellings (as appear in dataset, mostly clean).
KNOWN_STATES = {
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
}

# Top 30 cities — used for the heuristic urban classifier in the thin slice.
# Proper district-level mapping comes in a later phase.
URBAN_CITIES = {
    "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Ahmedabad",
    "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur",
    "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad",
    "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik",
    "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar",
    "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai",
    "Allahabad", "Prayagraj", "Ranchi", "Howrah", "Coimbatore", "Jabalpur",
    "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", "Kota", "Guwahati",
    "New Delhi",
}


def parse_string_array(raw: Any) -> list[str]:
    """Parse a stringified JSON array to a Python list. Handles 'null', '[]', empty."""
    if raw is None or raw == "" or raw == "null" or raw == "[]":
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def normalize_state(raw: Any) -> str | None:
    """Return canonical state spelling, or None if unrecognized."""
    if raw is None or raw == "" or raw == "null":
        return None
    s = str(raw).strip()
    if s in KNOWN_STATES:
        return s
    # Common variants
    variants = {
        "Bangalore Urban": "Karnataka",
        "Bangalore": "Karnataka",
    }
    return variants.get(s, s)  # pass through if unknown but non-empty


def is_urban(city: Any) -> bool:
    """Heuristic: facility is urban if its city is in the top-30 list. Else rural."""
    if city is None or city == "" or city == "null":
        return False
    return str(city).strip() in URBAN_CITIES


def coerce_int(raw: Any) -> int | None:
    """Parse 'null'/empty/non-numeric to None, else int."""
    if raw is None or raw == "" or raw == "null":
        return None
    try:
        return int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None
```

- [ ] **Step 2: Create `databricks/tests/test_parsers.py`**

```python
"""Run with: pytest databricks/tests/ -v"""
from databricks.lib.parsers import (
    coerce_int, is_urban, normalize_state, parse_string_array,
)


def test_parse_string_array_handles_null_sentinels():
    assert parse_string_array("null") == []
    assert parse_string_array("[]") == []
    assert parse_string_array("") == []
    assert parse_string_array(None) == []


def test_parse_string_array_handles_valid_json():
    assert parse_string_array('["a", "b"]') == ["a", "b"]
    assert parse_string_array('["familyMedicine"]') == ["familyMedicine"]


def test_parse_string_array_handles_malformed():
    assert parse_string_array("not json") == []
    assert parse_string_array('{"not": "array"}') == []


def test_normalize_state_canonical():
    assert normalize_state("Bihar") == "Bihar"
    assert normalize_state("Maharashtra") == "Maharashtra"


def test_normalize_state_null():
    assert normalize_state("null") is None
    assert normalize_state("") is None
    assert normalize_state(None) is None


def test_is_urban_known_city():
    assert is_urban("Mumbai") is True
    assert is_urban("Hyderabad") is True


def test_is_urban_unknown_city():
    assert is_urban("Some Village") is False
    assert is_urban("null") is False
    assert is_urban(None) is False


def test_coerce_int():
    assert coerce_int("5") == 5
    assert coerce_int("null") is None
    assert coerce_int("") is None
    assert coerce_int(None) is None
    assert coerce_int("not a number") is None
```

- [ ] **Step 3: Run parser tests locally and verify they pass**

```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani
python -m venv databricks/.venv
source databricks/.venv/bin/activate
pip install pytest
PYTHONPATH=. pytest databricks/tests/test_parsers.py -v
```

Expected: all 10 tests pass.

- [ ] **Step 4: Create `databricks/notebooks/01_bronze_silver.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 01 — Bronze + Silver
# MAGIC Loads CSV to `sanjeevani.bronze.facilities_raw`, parses to `sanjeevani.silver.facilities_parsed`.
# MAGIC Idempotent: uses `MERGE INTO` keyed on `facility_id`.

# COMMAND ----------

# MAGIC %pip install pydantic
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CSV_PATH = "/Volumes/sanjeevani/raw/india_healthcare_facilities.csv"
# If you uploaded the CSV elsewhere, adjust above. To upload via UI:
#   Catalog Explorer → sanjeevani → Create Volume "raw" → upload CSV.

CATALOG = "sanjeevani"

# COMMAND ----------

# MAGIC %md ## Step 1: Load to Bronze (raw)

# COMMAND ----------

import uuid
from pyspark.sql import functions as F

raw_df = (
    spark.read
    .option("header", "true")
    .option("multiLine", "true")
    .option("escape", '"')
    .csv(CSV_PATH)
)

# Add synthetic facility_id (deterministic hash so MERGE is stable across reruns)
raw_with_id = raw_df.withColumn(
    "facility_id",
    F.sha2(F.concat_ws("||", F.col("name"), F.col("address_line1"), F.col("address_zipOrPostcode")), 256)
)

print(f"Loaded {raw_with_id.count()} rows")

(raw_with_id.write
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(f"{CATALOG}.bronze.facilities_raw"))

display(spark.sql(f"SELECT COUNT(*) AS n FROM {CATALOG}.bronze.facilities_raw"))

# COMMAND ----------

# MAGIC %md ## Step 2: Parse to Silver

# COMMAND ----------

from pyspark.sql.types import ArrayType, BooleanType, StringType
import json

# Inline parser UDFs (mirroring databricks/lib/parsers.py — kept inline so notebook is self-contained)
KNOWN_STATES = {
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry",
}

URBAN_CITIES = {
    "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Ahmedabad",
    "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur",
    "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Patna",
    "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad",
    "Meerut", "Rajkot", "Varanasi", "Srinagar", "Coimbatore", "New Delhi",
}


@F.udf(returnType=ArrayType(StringType()))
def parse_array_udf(raw):
    if raw is None or raw in ("", "null", "[]"):
        return []
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    except Exception:
        return []


@F.udf(returnType=StringType())
def normalize_state_udf(raw):
    if raw is None or raw in ("", "null"):
        return None
    s = str(raw).strip()
    return s  # pass through; we already checked it's mostly clean

@F.udf(returnType=BooleanType())
def is_urban_udf(city):
    if city is None or city in ("", "null"):
        return False
    return str(city).strip() in URBAN_CITIES


bronze = spark.table(f"{CATALOG}.bronze.facilities_raw")

silver = (
    bronze
    .select(
        F.col("facility_id"),
        F.col("name"),
        parse_array_udf(F.col("phone_numbers")).alias("phone_numbers"),
        F.col("officialPhone").alias("official_phone"),
        F.col("email"),
        parse_array_udf(F.col("websites")).alias("websites"),
        F.col("address_line1"),
        F.col("address_line2"),
        F.col("address_line3"),
        F.col("address_city").alias("city"),
        normalize_state_udf(F.col("address_stateOrRegion")).alias("state"),
        F.col("address_zipOrPostcode").alias("pincode"),
        F.lit(None).cast("string").alias("district"),  # deferred to later phase
        is_urban_udf(F.col("address_city")).alias("is_urban"),
        (~is_urban_udf(F.col("address_city"))).alias("is_rural"),
        F.col("latitude").cast("double"),
        F.col("longitude").cast("double"),
        F.col("facilityTypeId").alias("facility_type"),
        F.col("operatorTypeId").alias("operator_type"),
        parse_array_udf(F.col("specialties")).alias("specialties"),
        parse_array_udf(F.col("procedure")).alias("procedure_list"),
        parse_array_udf(F.col("equipment")).alias("equipment_list"),
        parse_array_udf(F.col("capability")).alias("capability_list"),
        F.col("description"),
        F.col("numberDoctors").cast("int").alias("number_doctors"),
        F.col("capacity").cast("int").alias("capacity"),
        F.col("recency_of_page_update"),
        F.struct(
            F.col("distinct_social_media_presence_count").cast("int").alias("social_count"),
            (F.col("affiliated_staff_presence") == "TRUE").alias("affiliated_staff"),
            (F.col("custom_logo_presence") == "TRUE").alias("custom_logo"),
            F.col("number_of_facts_about_the_organization").cast("int").alias("num_facts"),
            F.col("engagement_metrics_n_followers").cast("int").alias("followers"),
            F.col("engagement_metrics_n_likes").cast("int").alias("likes"),
            F.col("engagement_metrics_n_engagements").cast("int").alias("engagements"),
            F.col("post_metrics_most_recent_social_media_post_date").alias("last_post_date"),
        ).alias("trust_meta"),
    )
)

silver.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{CATALOG}.silver.facilities_parsed"
)

# COMMAND ----------

# MAGIC %md ## Step 3: Sanity checks

# COMMAND ----------

result = spark.sql(f"""
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END) AS with_state,
        SUM(CASE WHEN latitude IS NOT NULL THEN 1 ELSE 0 END) AS with_geo,
        SUM(CASE WHEN is_rural THEN 1 ELSE 0 END) AS rural_count,
        SUM(CASE WHEN state = 'Bihar' THEN 1 ELSE 0 END) AS bihar_count
    FROM {CATALOG}.silver.facilities_parsed
""")
display(result)

# DoD: total ~10000, with_state ~10000, with_geo ~10000, bihar_count ~429
```

- [ ] **Step 5: Run the notebook in Databricks**

Upload CSV to `sanjeevani.raw` Volume first:
- Catalog Explorer → `sanjeevani` → Create Volume `raw` → Upload `data/india_healthcare_facilities.csv`

Then run all cells in `01_bronze_silver.py`. Verify the sanity output:
- `total` ≈ 10000
- `with_state` ≈ 10000
- `bihar_count` ≈ 429

- [ ] **Step 6: Commit**

```bash
git add databricks/notebooks/01_bronze_silver.py databricks/lib/parsers.py databricks/tests/test_parsers.py
git commit -m "feat(databricks): bronze+silver pipeline with parsers and tests"
```

---

## Task 5: Notebook 02 — Extract 100 Bihar Rows with Llama 3.3

**Files:**
- Create: `databricks/notebooks/02_extract.py`

LLM extraction with Llama 3.3 70B. Idempotent MERGE on `facility_id`. Thin slice: 100 Bihar rows only — same code that will run on full 10k later.

- [ ] **Step 1: Create `databricks/notebooks/02_extract.py`**

```python
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
```

- [ ] **Step 2: Run the notebook in Databricks**

Run all cells. Expected:
- `To extract: 100 rows` (or fewer if some Bihar rows already extracted from a prior run — that's correct idempotent behavior)
- Progress prints every 10 rows
- Final: `Extracted: 100, Failed: 0` (a few failures is OK — exp backoff handles rate limits)
- Sanity check shows 5 Bihar facilities with their extracted fields

- [ ] **Step 3: Commit**

```bash
git add databricks/notebooks/02_extract.py
git commit -m "feat(databricks): Llama 3.3 capability extraction (idempotent MERGE, thin-slice subset)"
```

---

## Task 6: Notebook 05 — Embeddings for the 100 Bihar Rows

**Files:**
- Create: `databricks/notebooks/05_embeddings.py`

Embed the same 100 rows. Idempotent on `facility_id`.

- [ ] **Step 1: Create `databricks/notebooks/05_embeddings.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 05 — Embeddings (gte-large-en, 1024-dim)
# MAGIC Idempotent: skips rows already in `gold.facility_embeddings`.

# COMMAND ----------

# MAGIC %pip install openai
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CATALOG = "sanjeevani"
EMBED_ENDPOINT = "databricks-gte-large-en"

# COMMAND ----------

# Ensure target exists
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.facility_embeddings (
        facility_id STRING,
        embedding ARRAY<FLOAT>,
        embedding_text STRING,
        embedded_at TIMESTAMP
    ) USING DELTA
""")

# Find facilities with extraction but no embedding yet
todo = spark.sql(f"""
    SELECT p.facility_id, p.name, p.description, e.explicit_capabilities,
           p.procedure_list, p.specialties
    FROM {CATALOG}.silver.facilities_parsed p
    JOIN {CATALOG}.silver.facilities_extracted e USING (facility_id)
    LEFT ANTI JOIN {CATALOG}.gold.facility_embeddings ge ON p.facility_id = ge.facility_id
""").collect()

print(f"To embed: {len(todo)} rows")

# COMMAND ----------

import os
import json
from datetime import datetime, timezone
from openai import OpenAI

_workspace = spark.conf.get("spark.databricks.workspaceUrl")
client = OpenAI(
    api_key=dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get(),
    base_url=f"https://{_workspace}/serving-endpoints",
)


def build_text(row) -> str:
    parts = [
        row.name or "",
        row.description or "",
        " ".join(row.explicit_capabilities or []),
        " ".join(row.procedure_list or []),
        " ".join(row.specialties or []),
    ]
    return " ".join(p for p in parts if p).strip()


# Batch in groups of 16 (gte-large-en supports batched inputs)
records = []
BATCH = 16
for start in range(0, len(todo), BATCH):
    chunk = todo[start:start + BATCH]
    texts = [build_text(r) for r in chunk]
    resp = client.embeddings.create(
        model=EMBED_ENDPOINT,
        input=texts,
    )
    for r, item in zip(chunk, resp.data):
        records.append({
            "facility_id": r.facility_id,
            "embedding": list(item.embedding),  # list[float], 1024 long
            "embedding_text": build_text(r),
            "embedded_at": datetime.now(timezone.utc),
        })
    print(f"  {min(start + BATCH, len(todo))}/{len(todo)}")

print(f"Embedded: {len(records)}")

# COMMAND ----------

# MAGIC %md ## MERGE into gold.facility_embeddings

# COMMAND ----------

if records:
    new_df = spark.createDataFrame(records)
    new_df.createOrReplaceTempView("new_embeddings")

    spark.sql(f"""
        MERGE INTO {CATALOG}.gold.facility_embeddings AS target
        USING new_embeddings AS source
        ON target.facility_id = source.facility_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total: {spark.table(f'{CATALOG}.gold.facility_embeddings').count()}")

# COMMAND ----------

# Sanity check
display(spark.sql(f"""
    SELECT facility_id, SIZE(embedding) AS dims, LEFT(embedding_text, 80) AS sample_text
    FROM {CATALOG}.gold.facility_embeddings
    LIMIT 5
"""))
```

- [ ] **Step 2: Run the notebook in Databricks**

Expected: ~100 rows embedded, dims=1024, sample_text populated.

- [ ] **Step 3: Commit**

```bash
git add databricks/notebooks/05_embeddings.py
git commit -m "feat(databricks): gte-large-en embeddings (idempotent MERGE, thin-slice subset)"
```

**Track A done at H+1.5–H+2.** Person A: stand by for joint integration (Task 13).

---

# Track B — Person B (alone, H0.5-H2)

## Task 7: Backend Project Setup + SSE Event Types

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/streaming/__init__.py`
- Create: `backend/app/streaming/sse.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_sse.py`

Defines the SSE event taxonomy (the "language" the agent uses to talk to the frontend).

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "sanjeevani-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "anthropic[bedrock]>=0.40",
    "openai>=1.55",
    "databricks-sql-connector>=3.5",
    "langgraph>=1.0",
    "langchain-core>=0.3",
    "mlflow>=3.0",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
    "rank-bm25>=0.2.2",
    "numpy>=2.0",
    "tenacity>=9.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Install backend deps**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ..
```

- [ ] **Step 3: Create `backend/app/streaming/sse.py`**

```python
"""SSE event taxonomy — the contract between agent and frontend.

Each event has a `type` and a `data` payload. Wire format: `data: {json}\n\n`.
"""
from __future__ import annotations

import json
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class EventType(str, Enum):
    THINKING_DELTA = "thinking_delta"          # Claude extended-thinking tokens
    AGENT_STEP_START = "agent_step_start"      # LangGraph node entry
    AGENT_STEP_END = "agent_step_end"          # LangGraph node exit
    TOOL_CALL = "tool_call"                    # tool invocation inside a node
    MODEL_PROPOSAL = "model_proposal"          # juror proposes (MoA mode, future)
    CONSENSUS_RESOLVED = "consensus_resolved"  # aggregator/jury verdict (future)
    TEXT_DELTA = "text_delta"                  # final answer tokens
    CITATION = "citation"                      # cited row + char offsets
    ERROR = "error"


class StreamEvent(BaseModel):
    type: EventType
    data: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        """Format as a single SSE message frame."""
        payload = json.dumps({"type": self.type.value, "data": self.data})
        return f"data: {payload}\n\n"


# Convenience constructors
def thinking(text: str) -> StreamEvent:
    return StreamEvent(type=EventType.THINKING_DELTA, data={"text": text})


def agent_step_start(name: str, summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.AGENT_STEP_START, data={"name": name, "summary": summary})


def agent_step_end(name: str, summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.AGENT_STEP_END, data={"name": name, "summary": summary})


def tool_call(name: str, input: Any, output_summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.TOOL_CALL, data={
        "name": name, "input": input, "output_summary": output_summary,
    })


def text(delta: str) -> StreamEvent:
    return StreamEvent(type=EventType.TEXT_DELTA, data={"text": delta})


def citation(facility_id: str, column: str, char_start: int, char_end: int, excerpt: str) -> StreamEvent:
    return StreamEvent(type=EventType.CITATION, data={
        "facility_id": facility_id,
        "column": column,
        "char_start": char_start,
        "char_end": char_end,
        "excerpt": excerpt,
    })


def error(message: str) -> StreamEvent:
    return StreamEvent(type=EventType.ERROR, data={"message": message})
```

- [ ] **Step 4: Create `backend/tests/test_sse.py`**

```python
"""Run with: cd backend && pytest -v"""
import json
from app.streaming.sse import (
    StreamEvent, EventType, thinking, agent_step_start, text, citation,
)


def test_to_sse_format():
    ev = StreamEvent(type=EventType.TEXT_DELTA, data={"text": "hi"})
    out = ev.to_sse()
    assert out.endswith("\n\n")
    assert out.startswith("data: ")
    payload = json.loads(out[6:].strip())
    assert payload == {"type": "text_delta", "data": {"text": "hi"}}


def test_thinking_helper():
    ev = thinking("Considering Bihar facilities...")
    assert ev.type == EventType.THINKING_DELTA
    assert ev.data == {"text": "Considering Bihar facilities..."}


def test_agent_step_helper():
    ev = agent_step_start("retriever", "looking up Bihar candidates")
    assert ev.type == EventType.AGENT_STEP_START
    assert ev.data["name"] == "retriever"


def test_text_helper():
    ev = text("Apollo Hospital")
    assert ev.type == EventType.TEXT_DELTA
    assert ev.data == {"text": "Apollo Hospital"}


def test_citation_helper():
    ev = citation("fac-123", "description", 12, 50, "performs surgery 24/7")
    assert ev.type == EventType.CITATION
    assert ev.data["facility_id"] == "fac-123"
    assert ev.data["char_start"] == 12
    assert ev.data["char_end"] == 50
```

- [ ] **Step 5: Create empty init files**

```bash
touch backend/app/__init__.py backend/app/streaming/__init__.py backend/tests/__init__.py
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
cd backend
source .venv/bin/activate
pytest -v
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/app/ backend/tests/
git commit -m "feat(backend): SSE event types and serializer with tests"
```

---

## Task 8: Backend LLM Clients (Bedrock + Databricks)

**Files:**
- Create: `backend/app/llm/__init__.py`
- Create: `backend/app/llm/bedrock.py`
- Create: `backend/app/llm/databricks_serving.py`
- Create: `backend/app/data/__init__.py`
- Create: `backend/app/data/databricks_sql.py`

Thin wrappers so the agent code doesn't repeat client setup.

- [ ] **Step 1: Create `backend/app/llm/bedrock.py`**

```python
"""Anthropic Claude via AWS Bedrock — used by the answer agent."""
import os
from anthropic import AnthropicBedrock

_client: AnthropicBedrock | None = None


def get_client() -> AnthropicBedrock:
    """Return a singleton AnthropicBedrock client."""
    global _client
    if _client is None:
        _client = AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def get_sonnet_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")
```

- [ ] **Step 2: Create `backend/app/llm/databricks_serving.py`**

```python
"""Databricks Model Serving (Llama 3.3, Qwen 3, embeddings) — OpenAI-compatible client."""
import os
from openai import OpenAI

_client: OpenAI | None = None


def get_client() -> OpenAI:
    """Return a singleton Databricks Model Serving client."""
    global _client
    if _client is None:
        host = os.environ["DATABRICKS_HOST"].rstrip("/")
        _client = OpenAI(
            api_key=os.environ["DATABRICKS_TOKEN"],
            base_url=f"{host}/serving-endpoints",
        )
    return _client


def get_llama_endpoint() -> str:
    return os.environ.get("DATABRICKS_LLAMA_ENDPOINT", "databricks-meta-llama-3-3-70b-instruct")


def get_embedding_endpoint() -> str:
    return os.environ.get("DATABRICKS_EMBEDDING_ENDPOINT", "databricks-gte-large-en")


def embed_query(text: str) -> list[float]:
    """Embed a single string with gte-large-en."""
    resp = get_client().embeddings.create(
        model=get_embedding_endpoint(),
        input=[text],
    )
    return list(resp.data[0].embedding)
```

- [ ] **Step 3: Create `backend/app/data/databricks_sql.py`**

```python
"""Databricks SQL Warehouse — used by the retriever agent."""
import os
from contextlib import contextmanager
from typing import Iterator

from databricks import sql
from databricks.sql.client import Connection


@contextmanager
def connect() -> Iterator[Connection]:
    host = os.environ["DATABRICKS_HOST"].replace("https://", "")
    with sql.connect(
        server_hostname=host,
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_TOKEN"],
    ) as conn:
        yield conn


def query(sql_text: str, params: dict | None = None) -> list[dict]:
    """Execute a SQL query and return rows as a list of dicts."""
    with connect() as conn:
        with conn.cursor() as cur:
            if params:
                cur.execute(sql_text, params)
            else:
                cur.execute(sql_text)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
```

- [ ] **Step 4: Create init files**

```bash
touch backend/app/llm/__init__.py backend/app/data/__init__.py
```

- [ ] **Step 5: Verify clients import cleanly**

```bash
cd backend
source .venv/bin/activate
python -c "from app.llm import bedrock, databricks_serving; from app.data import databricks_sql; print('ok')"
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/ backend/app/data/
git commit -m "feat(backend): Bedrock, Databricks Model Serving, and SQL client wrappers"
```

---

## Task 9: LangGraph 3-Node Agent (Intent → Retrieve → Answer)

**Files:**
- Create: `backend/app/agents/__init__.py`
- Create: `backend/app/agents/state.py`
- Create: `backend/app/agents/intent.py`
- Create: `backend/app/agents/retriever.py`
- Create: `backend/app/agents/answer.py`
- Create: `backend/app/agents/graph.py`

Minimal viable agent. Intent extracts query attributes; retriever does a simple SQL filter on `silver.facilities_parsed` joined with `silver.facilities_extracted` and `gold.facility_embeddings`; answer streams a cited response.

- [ ] **Step 1: Create `backend/app/agents/state.py`**

```python
"""Shared state passed between LangGraph nodes."""
from typing import TypedDict
from pydantic import BaseModel


class QueryIntent(BaseModel):
    state: str | None = None
    setting: str | None = None  # 'rural' | 'urban' | None
    capability: str | None = None
    raw_query: str = ""


class RetrievedFacility(BaseModel):
    facility_id: str
    name: str
    state: str | None
    city: str | None
    description: str | None
    explicit_capabilities: list[str] = []
    similarity: float = 0.0


class AgentState(TypedDict, total=False):
    query: str
    intent: QueryIntent
    candidates: list[RetrievedFacility]
    answer: str
```

- [ ] **Step 2: Create `backend/app/agents/intent.py`**

```python
"""Intent extraction node — parses query attributes (state, setting, capability)."""
import json
from app.agents.state import AgentState, QueryIntent
from app.llm.databricks_serving import get_client, get_llama_endpoint

INTENT_PROMPT = """Extract query attributes from a user's healthcare query. Return ONLY JSON.

Schema:
{{"state": <state name or null>, "setting": <"rural"|"urban"|null>, "capability": <short capability phrase or null>}}

Examples:
"rural Bihar emergency appendectomy" → {{"state": "Bihar", "setting": "rural", "capability": "emergency appendectomy"}}
"oncology hospitals in Mumbai" → {{"state": "Maharashtra", "setting": "urban", "capability": "oncology"}}
"facilities flagged for trust issues" → {{"state": null, "setting": null, "capability": null}}

Query: {query}

JSON:"""


def intent_node(state: AgentState) -> AgentState:
    query = state["query"]
    resp = get_client().chat.completions.create(
        model=get_llama_endpoint(),
        messages=[{"role": "user", "content": INTENT_PROMPT.format(query=query)}],
        max_tokens=200,
        temperature=0.0,
    )
    text = resp.choices[0].message.content.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    intent = QueryIntent(
        state=parsed.get("state"),
        setting=parsed.get("setting"),
        capability=parsed.get("capability"),
        raw_query=query,
    )
    return {**state, "intent": intent}
```

- [ ] **Step 3: Create `backend/app/agents/retriever.py`**

```python
"""Retriever node — filters candidates by intent, ranks by embedding cosine."""
import math
from app.agents.state import AgentState, RetrievedFacility
from app.data.databricks_sql import query
from app.llm.databricks_serving import embed_query


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def retriever_node(state: AgentState) -> AgentState:
    intent = state["intent"]

    # Build SQL filter clause
    where = ["1 = 1"]
    if intent.state:
        where.append(f"p.state = '{intent.state.replace(chr(39), chr(39)+chr(39))}'")
    if intent.setting == "rural":
        where.append("p.is_rural = TRUE")
    elif intent.setting == "urban":
        where.append("p.is_urban = TRUE")
    where_clause = " AND ".join(where)

    sql = f"""
        SELECT p.facility_id, p.name, p.state, p.city, p.description,
               COALESCE(e.explicit_capabilities, ARRAY()) AS explicit_capabilities,
               COALESCE(g.embedding, ARRAY()) AS embedding
        FROM sanjeevani.silver.facilities_parsed p
        LEFT JOIN sanjeevani.silver.facilities_extracted e USING (facility_id)
        LEFT JOIN sanjeevani.gold.facility_embeddings g USING (facility_id)
        WHERE {where_clause} AND g.embedding IS NOT NULL
        LIMIT 100
    """
    rows = query(sql)

    if not rows:
        return {**state, "candidates": []}

    # Embed the query
    qtext = intent.capability or intent.raw_query
    qvec = embed_query(qtext)

    scored = []
    for r in rows:
        emb = r.get("embedding") or []
        sim = cosine(qvec, list(emb)) if emb else 0.0
        scored.append(RetrievedFacility(
            facility_id=r["facility_id"],
            name=r["name"] or "",
            state=r.get("state"),
            city=r.get("city"),
            description=r.get("description"),
            explicit_capabilities=list(r.get("explicit_capabilities") or []),
            similarity=sim,
        ))

    scored.sort(key=lambda f: f.similarity, reverse=True)
    return {**state, "candidates": scored[:10]}
```

- [ ] **Step 4: Create `backend/app/agents/answer.py`**

```python
"""Answer node — Sonnet 4.6 reads top candidates, produces cited response."""
from collections.abc import Iterator
from app.agents.state import AgentState
from app.llm.bedrock import get_client, get_sonnet_model_id


ANSWER_PROMPT = """You are a healthcare advisor for India. A user has asked:

"{query}"

You have these candidate facilities (ranked by relevance):

{facilities}

Pick the top 3 most relevant. For each, give:
- Facility name and city
- Why it fits the query (cite specific text from its description or capabilities)
- Any caveats (missing info, partial fit)

Be concise — about 2-3 sentences per facility. If none fit well, say so."""


def format_facilities(candidates) -> str:
    parts = []
    for i, f in enumerate(candidates, 1):
        caps = ", ".join(f.explicit_capabilities[:5]) if f.explicit_capabilities else "(none)"
        parts.append(
            f"{i}. {f.name} — {f.city or '?'}, {f.state or '?'}\n"
            f"   Description: {(f.description or '(none)')[:300]}\n"
            f"   Capabilities: {caps}\n"
            f"   Similarity: {f.similarity:.3f}"
        )
    return "\n\n".join(parts) if parts else "(no candidates found)"


def answer_node_streaming(state: AgentState) -> Iterator[str]:
    """Yields text chunks (no SSE wrapping — caller wraps)."""
    candidates = state.get("candidates", [])
    prompt = ANSWER_PROMPT.format(
        query=state["query"],
        facilities=format_facilities(candidates),
    )
    client = get_client()
    with client.messages.stream(
        model=get_sonnet_model_id(),
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for delta in stream.text_stream:
            yield delta
```

- [ ] **Step 5: Create `backend/app/agents/graph.py`**

```python
"""LangGraph wiring — intent → retriever → answer (streaming via callback)."""
from collections.abc import Iterator

from langgraph.graph import StateGraph, START, END

from app.agents.state import AgentState
from app.agents.intent import intent_node
from app.agents.retriever import retriever_node
from app.agents.answer import answer_node_streaming
from app.streaming.sse import (
    StreamEvent, agent_step_start, agent_step_end, tool_call, text, citation, error,
)


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("intent", intent_node)
    graph.add_node("retriever", retriever_node)
    graph.add_edge(START, "intent")
    graph.add_edge("intent", "retriever")
    graph.add_edge("retriever", END)  # answer is streamed outside the graph
    return graph.compile()


def run_query_stream(query_text: str) -> Iterator[StreamEvent]:
    """Top-level: runs the graph, streams events, finishes with answer streaming."""
    try:
        yield agent_step_start("intent", "extracting query attributes")
        graph = build_graph()
        result = graph.invoke({"query": query_text})
        intent = result["intent"]
        yield agent_step_end("intent", f"state={intent.state} setting={intent.setting} capability={intent.capability}")

        yield agent_step_start("retriever", "querying facilities")
        yield tool_call("databricks_sql", {"state": intent.state}, output_summary=f"{len(result.get('candidates', []))} candidates")
        yield agent_step_end("retriever", f"{len(result.get('candidates', []))} candidates ranked")

        yield agent_step_start("answer", "synthesizing answer with Sonnet 4.6")
        for chunk in answer_node_streaming(result):
            yield text(chunk)
        yield agent_step_end("answer")

        # Emit citations for top 3 candidates
        for f in result.get("candidates", [])[:3]:
            if f.description:
                excerpt = f.description[:200]
                yield citation(f.facility_id, "description", 0, len(excerpt), excerpt)
    except Exception as e:
        yield error(f"{type(e).__name__}: {e}")
```

- [ ] **Step 6: Create init file**

```bash
touch backend/app/agents/__init__.py
```

- [ ] **Step 7: Smoke-test the graph (no FastAPI yet)**

```bash
cd backend
source .venv/bin/activate
python -c "
from dotenv import load_dotenv
load_dotenv('../.env')
from app.agents.graph import run_query_stream
for ev in run_query_stream('rural Bihar emergency appendectomy'):
    print(ev.type.value, str(ev.data)[:150])
"
```

Expected output: agent_step_start/end events for intent, retriever, answer, plus text_delta tokens streaming, plus citations at the end. If errors: check `.env` is loaded, Bedrock auth works, Databricks tables exist (Track A must be done with at least Tasks 4 + 6).

- [ ] **Step 8: Commit**

```bash
git add backend/app/agents/
git commit -m "feat(backend): LangGraph agent with intent, retriever, streaming answer"
```

---

## Task 10: FastAPI /query SSE Endpoint + MLflow Autolog

**Files:**
- Create: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/main.py`**

```python
"""FastAPI entry point — single /query SSE endpoint."""
import os
from dotenv import load_dotenv
load_dotenv()  # load .env from repo root if backend started from there

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.graph import run_query_stream


@asynccontextmanager
async def lifespan(app: FastAPI):
    # MLflow autolog (one line — captures every LangGraph node trace)
    try:
        import mlflow
        mlflow.langchain.autolog()
        if os.environ.get("MLFLOW_EXPERIMENT_NAME"):
            mlflow.set_experiment(os.environ["MLFLOW_EXPERIMENT_NAME"])
        print("[startup] MLflow autolog enabled")
    except Exception as e:
        print(f"[startup] MLflow autolog skipped: {e}")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/query")
def query_endpoint(req: QueryRequest):
    def event_stream():
        for ev in run_query_stream(req.query):
            yield ev.to_sse()
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FASTAPI_PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
```

- [ ] **Step 2: Run the FastAPI server**

```bash
cd backend
source .venv/bin/activate
python -m app.main
```

Expected:
```
[startup] MLflow autolog enabled
INFO:     Uvicorn running on http://0.0.0.0:8000
```

Leave it running.

- [ ] **Step 3: Smoke-test from another terminal**

```bash
curl -N -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "rural Bihar emergency appendectomy"}'
```

Expected: a stream of `data: {"type": ..., "data": ...}` lines, ending with the final answer.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(backend): FastAPI /query SSE endpoint with MLflow autolog"
```

---

## Task 11: Next.js 16 Scaffold with shadcn/ui + Tailwind

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/next.config.js`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/.env.local`
- Create: `frontend/components/ui/button.tsx`
- Create: `frontend/components/ui/input.tsx`
- Create: `frontend/lib/utils.ts`

- [ ] **Step 1: Bootstrap Next.js 16**

```bash
cd frontend
npx --yes create-next-app@16 . --ts --tailwind --eslint --app --src-dir false --import-alias '@/*' --use-npm
```

When prompted:
- Use App Router: Yes
- Use src/ directory: No
- Customize import alias: Yes (`@/*`)
- Use Turbopack: Yes (default)

- [ ] **Step 2: Add `cacheComponents: true` to `next.config.js`**

Replace `frontend/next.config.js` (or `.ts`) contents with:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  experimental: {
    // any other experimental flags here
  },
};

module.exports = nextConfig;
```

- [ ] **Step 3: Install shadcn/ui + minimal components**

```bash
cd frontend
npx --yes shadcn@latest init
```

When prompted: TypeScript yes, default style, slate base color, CSS variables yes.

```bash
npx --yes shadcn@latest add button input card
```

- [ ] **Step 4: Create `.env.local`**

```bash
cat > frontend/.env.local <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
```

- [ ] **Step 5: Verify dev server starts**

```bash
cd frontend
npm run dev
```

Expected: `▲ Next.js 16.x` running at `http://localhost:3000`. Open browser; default Next.js page renders.

Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): Next.js 16 scaffold with cacheComponents and shadcn/ui"
```

---

## Task 12: Frontend Chat Page with SSE Consumer

**Files:**
- Create: `frontend/lib/sse.ts`
- Modify: `frontend/app/page.tsx`
- Create: `frontend/components/chat/Chat.tsx`

- [ ] **Step 1: Create `frontend/lib/sse.ts`**

```typescript
/**
 * Custom SSE consumer for our event taxonomy.
 * Reads a POST → text/event-stream response and yields parsed events.
 */
export type EventType =
  | "thinking_delta"
  | "agent_step_start"
  | "agent_step_end"
  | "tool_call"
  | "model_proposal"
  | "consensus_resolved"
  | "text_delta"
  | "citation"
  | "error";

export interface StreamEvent {
  type: EventType;
  data: Record<string, unknown>;
}

export async function* streamQuery(query: string): AsyncGenerator<StreamEvent> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const resp = await fetch(`${apiUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are delimited by \n\n
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith("data: ")) {
        const json = frame.slice(6);
        try {
          yield JSON.parse(json) as StreamEvent;
        } catch (e) {
          // skip malformed frame
          console.warn("malformed SSE frame", e);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create `frontend/components/chat/Chat.tsx`**

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { streamQuery, type StreamEvent } from "@/lib/sse";

interface TraceItem {
  name: string;
  summary?: string;
  status: "running" | "done";
}

export function Chat() {
  const [query, setQuery] = useState("rural Bihar emergency appendectomy with part-time doctors");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [thinking, setThinking] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [citations, setCitations] = useState<Array<{ facility_id: string; excerpt: string }>>([]);

  async function submit() {
    setRunning(true);
    setTrace([]);
    setThinking("");
    setAnswer("");
    setCitations([]);
    try {
      for await (const ev of streamQuery(query)) {
        handleEvent(ev);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "agent_step_start":
        setTrace((t) => [...t, {
          name: String(ev.data.name),
          summary: String(ev.data.summary ?? ""),
          status: "running",
        }]);
        break;
      case "agent_step_end":
        setTrace((t) => t.map((item, i) =>
          i === t.length - 1 || item.name === ev.data.name
            ? { ...item, status: "done", summary: String(ev.data.summary ?? item.summary ?? "") }
            : item
        ));
        break;
      case "thinking_delta":
        setThinking((s) => s + String(ev.data.text ?? ""));
        break;
      case "text_delta":
        setAnswer((s) => s + String(ev.data.text ?? ""));
        break;
      case "citation":
        setCitations((c) => [...c, {
          facility_id: String(ev.data.facility_id),
          excerpt: String(ev.data.excerpt),
        }]);
        break;
      case "error":
        setAnswer((s) => s + `\n\n[error] ${ev.data.message}`);
        break;
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4 p-6 max-w-7xl mx-auto">
      <Card className="col-span-12 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about Indian healthcare facilities..."
            disabled={running}
          />
          <Button type="submit" disabled={running}>
            {running ? "Thinking..." : "Send"}
          </Button>
        </form>
      </Card>

      <Card className="col-span-4 p-4 max-h-[70vh] overflow-y-auto">
        <h3 className="text-sm font-semibold mb-3 text-slate-600">Agent trace</h3>
        <ol className="space-y-2 text-sm">
          {trace.map((t, i) => (
            <li key={i} className="border-l-2 border-slate-300 pl-3">
              <div className="font-mono text-xs text-slate-500">
                {t.status === "running" ? "▶" : "✓"} {t.name}
              </div>
              {t.summary && <div className="text-slate-700">{t.summary}</div>}
            </li>
          ))}
          {trace.length === 0 && <li className="text-slate-400 italic">no activity</li>}
        </ol>
      </Card>

      <Card className="col-span-8 p-4 max-h-[70vh] overflow-y-auto">
        {thinking && (
          <div className="mb-4 p-3 bg-slate-50 italic text-slate-500 text-sm rounded">
            <div className="font-semibold mb-1 not-italic">Reasoning</div>
            {thinking}
          </div>
        )}
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">
          {answer || <span className="text-slate-400 italic">answer will stream here</span>}
        </div>
        {citations.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Citations</h4>
            <ul className="space-y-2 text-xs">
              {citations.map((c, i) => (
                <li key={i} className="font-mono text-slate-700">
                  <span className="text-slate-400">[{c.facility_id.slice(0, 8)}]</span>{" "}
                  {c.excerpt}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Modify `frontend/app/page.tsx`**

Replace the file contents entirely:

```typescript
import { Chat } from "@/components/chat/Chat";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">Sanjeevani</h1>
          <p className="text-sm text-slate-500">
            Agentic healthcare intelligence for India
          </p>
        </div>
      </div>
      <Chat />
    </main>
  );
}
```

- [ ] **Step 4: Run dev server and verify**

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`. Verify:
- Page loads with title "Sanjeevani"
- Input prefilled with the Bihar query
- "Send" button visible

Don't click Send yet — backend may not be running.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): chat page with custom SSE consumer and trace panel"
```

**Track B done at H+1.5–H+2.** Person B: stand by for joint integration.

---

# Joint Integration (H+1.75 – H+2)

## Task 13: End-to-End Smoke Test

Both people. Run the full stack and verify Q1 works.

- [ ] **Step 1: Verify Track A is done**

Person A confirms in Databricks:
```sql
SELECT
  (SELECT COUNT(*) FROM sanjeevani.silver.facilities_parsed)        AS parsed,
  (SELECT COUNT(*) FROM sanjeevani.silver.facilities_extracted)     AS extracted,
  (SELECT COUNT(*) FROM sanjeevani.gold.facility_embeddings)        AS embedded;
```

Expected: parsed ≈ 10000, extracted ≈ 100, embedded ≈ 100. If extracted/embedded < 100, rerun the relevant notebook.

- [ ] **Step 2: Person B starts the backend**

```bash
cd backend
source .venv/bin/activate
python -m app.main
```

Leave running. Confirm `Uvicorn running on http://0.0.0.0:8000`.

- [ ] **Step 3: Person B starts the frontend**

In another terminal:
```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 4: Submit the canonical query**

In the chat input (already prefilled):
- Click Send
- Verify trace panel populates: `intent → done`, `retriever → N candidates ranked`, `answer → done`
- Verify answer streams text into the right panel
- Verify at least one citation appears

If any step fails, the error event will surface in the answer pane. Common issues:
- Backend not running → frontend hangs → check terminal
- Bedrock timeout → check `.env` `AWS_REGION` and bearer token
- No candidates found → check Bihar rows have embeddings (re-run notebook 05)

- [ ] **Step 5: Verify MLflow trace exists**

In Databricks workspace → Experiments → look for `sanjeevani-traces` (or whatever `MLFLOW_EXPERIMENT_NAME` is set to). Should see at least one trace from the query above with `intent`, `retriever` spans.

- [ ] **Step 6: Commit any fixes from integration**

```bash
git add -A
git commit -m "fix: integration tweaks from joint smoke test" || echo "no fixes needed"
```

---

## Task 14: Tag the Thin-Slice Milestone

- [ ] **Step 1: Tag the commit**

```bash
git tag -a thin-slice -m "Phase A1+B1 complete: end-to-end demo of Bihar appendectomy query"
git log --oneline -10
```

- [ ] **Step 2: Update root README with run instructions**

Append to `README.md`:

```markdown

## Quick start (thin slice)

Prereqs: `.env` populated with Bedrock + Databricks credentials. Connection sanity:
```bash
python scripts/sanity_check.py
```

Run the full stack:

1. **Databricks** — run notebooks `00_setup_uc.py`, `01_bronze_silver.py`, `02_extract.py`, `05_embeddings.py` in order (in the workspace UI).
2. **Backend**:
   ```bash
   cd backend && source .venv/bin/activate && python -m app.main
   ```
3. **Frontend**:
   ```bash
   cd frontend && npm run dev
   ```
4. Open http://localhost:3000 and ask: *"rural Bihar emergency appendectomy with part-time doctors"*
```

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: thin-slice quick-start"
```

**Phase A1+B1 done at H+2.** Both team members move to their parallel tracks (next plan: Phase A2-A7 for Person A, B2-B7 for Person B).

---

## Notes for Subsequent Phases

- **Track A next** (H+2 onward): Run `02_extract.py` against ALL non-Bihar rows (`SUBSET_FILTER='1=1'`, drop `LIMIT`); then `03_trust_rules.py` (rules), `04_jury.py` (multi-model jury — the long pole), `05_embeddings.py` again (rest of 9.9k), `06_aggregates.py`, `07_trust_scores.py`.
- **Track B next** (H+2 onward): Wire up the full SSE event taxonomy (model_proposal, consensus_resolved, more thinking_delta), upgrade single-proposer to MoA dual-proposer + aggregator, add validator node, build map page, trust panel, jury widget, crisis overlay.
- **Idempotency tested:** Re-running extraction notebooks should be a no-op. If it processes rows already done, MERGE logic is broken — investigate before scaling.
