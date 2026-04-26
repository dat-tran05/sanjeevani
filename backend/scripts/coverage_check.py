"""Quick coverage check: how much of the gold/silver pipeline is populated?

Run from backend/ with the venv:  python scripts/coverage_check.py
"""
from dotenv import load_dotenv
load_dotenv()

from app.data.databricks_sql import query


def fmt(label: str, n: int, total: int | None = None) -> str:
    if total is None or total == 0:
        return f"  {label:<40} {n:>8,}"
    pct = 100 * n / total
    return f"  {label:<40} {n:>8,}  ({pct:5.1f}%)"


def main() -> None:
    print("=" * 60)
    print("Sanjeevani pipeline coverage")
    print("=" * 60)

    rows = query("SELECT COUNT(*) AS n FROM sanjeevani.silver.facilities_parsed")
    total = int(rows[0]["n"])
    print(fmt("silver.facilities_parsed (universe)", total))

    for table, cond, label in [
        ("sanjeevani.silver.facilities_parsed", "description IS NOT NULL AND description != ''", "  ↳ has description"),
        ("sanjeevani.silver.facilities_extracted", "1=1", "silver.facilities_extracted (LLM-extracted)"),
        ("sanjeevani.silver.facilities_extracted", "specialties IS NOT NULL AND size(specialties) > 0", "  ↳ has specialties"),
        ("sanjeevani.silver.facilities_extracted", "procedure_list IS NOT NULL AND size(procedure_list) > 0", "  ↳ has procedures"),
        ("sanjeevani.silver.facilities_extracted", "equipment_list IS NOT NULL AND size(equipment_list) > 0", "  ↳ has equipment"),
        ("sanjeevani.silver.facility_claims", "1=1", "silver.facility_claims (decomposed)"),
        ("sanjeevani.gold.trust_scores", "1=1", "gold.trust_scores (4-dim badge)"),
        ("sanjeevani.gold.trust_verdicts", "1=1", "gold.trust_verdicts (jury rows)"),
    ]:
        try:
            r = query(f"SELECT COUNT(*) AS n FROM {table} WHERE {cond}")
            print(fmt(label, int(r[0]["n"]), total))
        except Exception as e:
            print(f"  {label:<40}    ERROR: {type(e).__name__}: {e}")

    # Distinct facility coverage (claims/verdicts roll up many rows per facility)
    print()
    print("Distinct facility coverage in downstream tables:")
    for table, label in [
        ("sanjeevani.silver.facility_claims", "facilities with ≥1 claim"),
        ("sanjeevani.gold.trust_verdicts", "facilities with ≥1 jury verdict"),
    ]:
        try:
            r = query(f"""
                SELECT COUNT(DISTINCT v.facility_id) AS n
                FROM {table} v
                WHERE v.facility_id IS NOT NULL
            """)
            print(fmt(label, int(r[0]["n"]), total))
        except Exception as e:
            try:
                r = query(f"""
                    SELECT COUNT(DISTINCT c.facility_id) AS n
                    FROM {table} v
                    JOIN sanjeevani.silver.facility_claims c USING (claim_id)
                """)
                print(fmt(label, int(r[0]["n"]), total))
            except Exception as e2:
                print(f"  {label:<40}    ERROR: {type(e2).__name__}: {e2}")


if __name__ == "__main__":
    main()
