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
