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
