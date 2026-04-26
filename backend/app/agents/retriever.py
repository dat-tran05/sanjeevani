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
        # databricks-sql-connector returns ARRAY<FLOAT> as numpy arrays —
        # use explicit None / len checks (truthiness raises for ndarrays >1).
        emb = r.get("embedding")
        if emb is None or len(emb) == 0:
            sim = 0.0
        else:
            sim = cosine(qvec, list(emb))
        caps = r.get("explicit_capabilities")
        scored.append(RetrievedFacility(
            facility_id=r["facility_id"],
            name=r["name"] or "",
            state=r.get("state"),
            city=r.get("city"),
            description=r.get("description"),
            explicit_capabilities=list(caps) if caps is not None and len(caps) > 0 else [],
            similarity=sim,
        ))

    scored.sort(key=lambda f: f.similarity, reverse=True)
    return {**state, "candidates": scored[:10]}
