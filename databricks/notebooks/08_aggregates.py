# Databricks notebook source
# MAGIC %md
# MAGIC # 08 — Region Capability Stats (powers crisis map)
# MAGIC Aggregates `gold.trust_verdicts` (joined w/ tiebreakers) by (state, district, capability).
# MAGIC Writes `gold.region_capability_stats`. Idempotent OVERWRITE.

# COMMAND ----------

CATALOG = "sanjeevani"

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.region_capability_stats (
        state STRING,
        district STRING,
        capability STRING,
        facilities_count INT,
        verified_count INT,
        gap_severity FLOAT
    ) USING DELTA
""")

# COMMAND ----------

# District is null in silver.facilities_parsed — fall back to city as the granularity
result = spark.sql(f"""
    WITH per_claim_final AS (
        SELECT v.claim_id,
               COALESCE(t.final_verdict,
                        CASE
                          WHEN sup_count >= 2 THEN 'supported'
                          WHEN uns_count >= 2 THEN 'unsupported'
                          ELSE 'partial'
                        END) AS final_verdict
        FROM (
            SELECT claim_id,
                   SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS sup_count,
                   SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns_count
            FROM {CATALOG}.gold.trust_verdicts
            GROUP BY claim_id
        ) v
        LEFT JOIN {CATALOG}.gold.tiebreaker_verdicts t USING (claim_id)
    ),
    claim_meta AS (
        SELECT c.claim_id, c.facility_id, c.claim_type, p.state, p.city AS district
        FROM {CATALOG}.silver.facility_claims c
        JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    )
    SELECT
        cm.state, cm.district, cm.claim_type AS capability,
        COUNT(DISTINCT cm.facility_id) AS facilities_count,
        COUNT(DISTINCT CASE
            WHEN pcf.final_verdict IN ('supported','partial')
            THEN cm.facility_id END) AS verified_count,
        CAST(1.0 - (
            COUNT(DISTINCT CASE
                WHEN pcf.final_verdict IN ('supported','partial')
                THEN cm.facility_id END) * 1.0 /
            GREATEST(COUNT(DISTINCT cm.facility_id), 1)
        ) AS FLOAT) AS gap_severity
    FROM claim_meta cm
    JOIN per_claim_final pcf USING (claim_id)
    GROUP BY cm.state, cm.district, cm.claim_type
""")

result.write.mode("overwrite").saveAsTable(f"{CATALOG}.gold.region_capability_stats")
print(f"Wrote {result.count()} (state, district, capability) rows")

# COMMAND ----------

display(spark.sql(f"""
    SELECT * FROM {CATALOG}.gold.region_capability_stats
    WHERE capability='picu' AND state='Tamil Nadu'
    ORDER BY gap_severity DESC LIMIT 10
"""))
