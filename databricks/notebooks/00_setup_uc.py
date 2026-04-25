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
