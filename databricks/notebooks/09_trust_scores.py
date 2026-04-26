# Databricks notebook source
# MAGIC %md
# MAGIC # 09 — Trust Scores (4-dimension badges per facility)
# MAGIC Combines jury verdicts + meta-signals into existence/coherence/recency/specificity.
# MAGIC Writes `gold.trust_scores`. Idempotent OVERWRITE.

# COMMAND ----------

CATALOG = "sanjeevani"

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.trust_scores (
        facility_id STRING,
        existence FLOAT,
        coherence FLOAT,
        recency FLOAT,
        specificity FLOAT
    ) USING DELTA
""")

# COMMAND ----------

# Existence: meta-signals weighted average. Signals come from silver.facilities_parsed.trust_meta.
# Coherence: average jury agreement on this facility's claims (1 - dissent_rate).
# Recency: trust_meta.last_post_date freshness (rough heuristic).
# Specificity: count of structured items (procedures, equipment, staff) bucketed.
result = spark.sql(f"""
    WITH coh AS (
        SELECT c.facility_id,
               AVG(
                   CASE
                     WHEN sup = 3 OR uns = 3 OR part = 3 THEN 1.0
                     WHEN sup = 2 OR uns = 2 THEN 0.66
                     ELSE 0.33
                   END
               ) AS coherence
        FROM {CATALOG}.silver.facility_claims c
        JOIN (
            SELECT claim_id,
                   SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS sup,
                   SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS part,
                   SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns
            FROM {CATALOG}.gold.trust_verdicts GROUP BY claim_id
        ) v USING (claim_id)
        GROUP BY c.facility_id
    )
    SELECT
        p.facility_id,
        CAST(LEAST(1.0, (
            (CASE WHEN p.email IS NOT NULL AND p.email <> '' THEN 0.20 ELSE 0 END) +
            (CASE WHEN size(p.websites) > 0 THEN 0.20 ELSE 0 END) +
            (CASE WHEN p.trust_meta.social_count > 0 THEN 0.20 ELSE 0 END) +
            (CASE WHEN p.trust_meta.custom_logo THEN 0.15 ELSE 0 END) +
            (CASE WHEN p.trust_meta.affiliated_staff THEN 0.15 ELSE 0 END) +
            (CASE WHEN p.trust_meta.followers > 50 THEN 0.10 ELSE 0 END)
        )) AS FLOAT) AS existence,
        CAST(COALESCE(coh.coherence, 0.5) AS FLOAT) AS coherence,
        CAST(CASE
            WHEN p.trust_meta.last_post_date IS NULL THEN 0.3
            WHEN p.trust_meta.last_post_date >= '2025-01-01' THEN 0.95
            WHEN p.trust_meta.last_post_date >= '2024-01-01' THEN 0.7
            WHEN p.trust_meta.last_post_date >= '2023-01-01' THEN 0.5
            ELSE 0.3
        END AS FLOAT) AS recency,
        CAST(LEAST(1.0,
            (size(p.procedure_list) * 0.05 +
             size(p.equipment_list) * 0.07 +
             size(p.specialties) * 0.03)
        ) AS FLOAT) AS specificity
    FROM {CATALOG}.silver.facilities_parsed p
    LEFT JOIN coh USING (facility_id)
""")

result.write.mode("overwrite").saveAsTable(f"{CATALOG}.gold.trust_scores")
print(f"Wrote trust_scores for {result.count()} facilities")

# COMMAND ----------

display(spark.sql(f"""
    SELECT t.facility_id, p.name, t.existence, t.coherence, t.recency, t.specificity
    FROM {CATALOG}.gold.trust_scores t
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    ORDER BY (t.existence + t.coherence + t.recency + t.specificity) DESC LIMIT 10
"""))
