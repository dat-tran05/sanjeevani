"""FastAPI entry — /query SSE + /facilities/all + /facilities/{id} + /crisis-map."""
import os
from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.graph import run_query_stream
from app.data.databricks_sql import query as db_query


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        import mlflow
        mlflow.langchain.autolog()
        if os.environ.get("MLFLOW_EXPERIMENT_NAME"):
            mlflow.set_experiment(os.environ["MLFLOW_EXPERIMENT_NAME"])
        print("[startup] MLflow autolog enabled")
    except Exception as e:
        print(f"[startup] MLflow autolog skipped: {e}")
    try:
        from app.retrieval.index import load_index
        load_index()
    except Exception as e:
        print(f"[startup] retrieval index load failed: {e}")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
    ],
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


@lru_cache(maxsize=1)
def _all_facilities_payload() -> list[dict[str, Any]]:
    rows = db_query("""
        SELECT p.facility_id, p.name, p.latitude, p.longitude, p.state, p.city, p.facility_type,
               (v.facility_id IS NOT NULL) AS verified
        FROM sanjeevani.silver.facilities_parsed p
        LEFT JOIN (
            SELECT DISTINCT c.facility_id
            FROM sanjeevani.silver.facility_claims c
            JOIN sanjeevani.gold.trust_verdicts tv USING (claim_id)
        ) v USING (facility_id)
        WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
    """)
    return [
        {
            "id": r["facility_id"], "name": r["name"],
            "lat": float(r["latitude"]), "lon": float(r["longitude"]),
            "state": r.get("state"), "city": r.get("city"),
            "type": r.get("facility_type"),
            "verified": bool(r.get("verified")),
        }
        for r in rows
    ]


@app.get("/facilities/all")
def facilities_all():
    return {"facilities": _all_facilities_payload()}


@app.get("/facilities/{facility_id}")
def facility_detail(facility_id: str):
    rows = db_query(f"""
        SELECT p.facility_id, p.name, p.state, p.city, p.description,
               p.latitude, p.longitude, p.facility_type, p.specialties,
               p.procedure_list, p.equipment_list,
               t.existence, t.coherence, t.recency, t.specificity,
               e.explicit_capabilities, e.surgery_capable, e.emergency_24_7
        FROM sanjeevani.silver.facilities_parsed p
        LEFT JOIN sanjeevani.gold.trust_scores t USING (facility_id)
        LEFT JOIN sanjeevani.silver.facilities_extracted e USING (facility_id)
        WHERE p.facility_id = '{facility_id.replace(chr(39), chr(39)+chr(39))}'
    """)
    if not rows:
        raise HTTPException(status_code=404, detail="facility not found")
    r = rows[0]
    trust_badge = None
    if r.get("existence") is not None:
        trust_badge = {
            "existence": float(r["existence"]),
            "coherence": float(r["coherence"]),
            "recency": float(r["recency"]),
            "specificity": float(r["specificity"]),
        }
    return {
        "id": r["facility_id"], "name": r["name"],
        "state": r.get("state"), "city": r.get("city"),
        "lat": float(r["latitude"]) if r.get("latitude") is not None else None,
        "lon": float(r["longitude"]) if r.get("longitude") is not None else None,
        "description": r.get("description"),
        "type": r.get("facility_type"),
        "specialties": list(r["specialties"]) if r.get("specialties") is not None else [],
        "procedures": list(r["procedure_list"]) if r.get("procedure_list") is not None else [],
        "equipment": list(r["equipment_list"]) if r.get("equipment_list") is not None else [],
        "explicit_capabilities": list(r["explicit_capabilities"]) if r.get("explicit_capabilities") is not None else [],
        "surgery_capable": r.get("surgery_capable"),
        "emergency_24_7": r.get("emergency_24_7"),
        "trust_badge": trust_badge,
    }


# Capability id (frontend) → claim_type strings present in silver.facility_claims.
# Empty list = capability has no jury data yet → endpoint falls back to overall trust.
CAPABILITY_TO_CLAIM_TYPES: dict[str, list[str]] = {
    "emergency": ["emergency_surgery", "general_surgery", "icu_24_7"],
    "neonatal":  ["picu", "obstetrics"],
    "dialysis":  [],
    "oncology":  ["oncology_specialty"],
    "cardiac":   [],
    "trauma":    ["emergency_surgery", "general_surgery"],
}


@app.get("/districts/best")
def districts_best(state: str, city: str, capability: str = "emergency", limit: int = 3):
    """Top facilities in a (state, city), ranked by trust score.

    Facilities with a supported claim matching the capability sort above
    facilities without (so capability-relevant ones surface first), but the
    endpoint still returns results when no claim data exists for the chosen
    capability — it just degrades to pure trust ranking.
    """
    if capability not in CAPABILITY_TO_CLAIM_TYPES:
        raise HTTPException(status_code=400, detail=f"unknown capability: {capability}")
    n = max(1, min(int(limit), 25))
    state_q = state.replace("'", "''")
    city_q = city.replace("'", "''")
    claim_types = CAPABILITY_TO_CLAIM_TYPES[capability]
    if claim_types:
        claim_filter = "(" + ", ".join(f"'{ct}'" for ct in claim_types) + ")"
        cap_clause = f"MAX(CASE WHEN c.claim_type IN {claim_filter} THEN 1 ELSE 0 END)"
    else:
        cap_clause = "0"

    rows = db_query(f"""
        SELECT
            p.facility_id AS id, p.name, p.state, p.city,
            p.facility_type AS type,
            p.latitude AS lat, p.longitude AS lon,
            t.existence, t.coherence, t.recency, t.specificity,
            (COALESCE(t.existence,0) + COALESCE(t.coherence,0)
             + COALESCE(t.recency,0) + COALESCE(t.specificity,0)) AS trust_total,
            {cap_clause} AS has_cap_claim
        FROM sanjeevani.silver.facilities_parsed p
        LEFT JOIN sanjeevani.gold.trust_scores t ON t.facility_id = p.facility_id
        LEFT JOIN sanjeevani.silver.facility_claims c ON c.facility_id = p.facility_id
        WHERE p.state = '{state_q}' AND p.city = '{city_q}'
          AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        GROUP BY p.facility_id, p.name, p.state, p.city, p.facility_type,
                 p.latitude, p.longitude,
                 t.existence, t.coherence, t.recency, t.specificity
        ORDER BY has_cap_claim DESC, trust_total DESC
        LIMIT {n}
    """)

    facilities = []
    for r in rows:
        trust = None
        if r.get("existence") is not None:
            trust = {
                "existence": float(r["existence"]),
                "coherence": float(r["coherence"]),
                "recency": float(r["recency"]),
                "specificity": float(r["specificity"]),
            }
        facilities.append({
            "id": r["id"], "name": r["name"],
            "state": r.get("state"), "city": r.get("city"),
            "type": r.get("type"),
            "lat": float(r["lat"]) if r.get("lat") is not None else None,
            "lon": float(r["lon"]) if r.get("lon") is not None else None,
            "trust_badge": trust,
            "matches_capability": bool(r.get("has_cap_claim")),
        })
    return {
        "state": state, "city": city, "capability": capability,
        "facilities": facilities,
    }


@app.get("/crisis-map")
def crisis_map(capability: str, state: str | None = None):
    where_clauses = [f"s.capability = '{capability.replace(chr(39), chr(39)+chr(39))}'"]
    if state:
        where_clauses.append(f"s.state = '{state.replace(chr(39), chr(39)+chr(39))}'")

    rows = db_query(f"""
        SELECT s.state, s.district, s.facilities_count, s.verified_count, s.gap_severity,
               AVG(p.latitude) AS lat, AVG(p.longitude) AS lon
        FROM sanjeevani.gold.region_capability_stats s
        LEFT JOIN sanjeevani.silver.facilities_parsed p
            ON p.state = s.state AND p.city = s.district
        WHERE {' AND '.join(where_clauses)}
        GROUP BY s.state, s.district, s.facilities_count, s.verified_count, s.gap_severity
        ORDER BY s.gap_severity DESC
    """)
    districts = []
    for r in rows:
        districts.append({
            "state": r["state"], "district": r["district"],
            "facilities_count": int(r["facilities_count"] or 0),
            "verified_count": int(r["verified_count"] or 0),
            "gap_severity": float(r["gap_severity"] or 0.0),
            "lat": float(r["lat"]) if r.get("lat") is not None else None,
            "lon": float(r["lon"]) if r.get("lon") is not None else None,
        })
    return {"capability": capability, "state": state, "districts": districts}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FASTAPI_PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
