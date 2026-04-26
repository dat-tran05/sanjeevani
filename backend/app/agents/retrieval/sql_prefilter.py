"""SQL prefilter node — narrows candidates by structured intent (state, geo, type)."""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import QueryIntent, AgentState
from app.data.databricks_sql import query
from app.streaming.sse import StreamEvent, tool_call


def _build_where(intent: QueryIntent) -> str:
    clauses = ["1 = 1"]
    if intent.state:
        clauses.append(f"p.state = '{intent.state.replace(chr(39), chr(39)+chr(39))}'")
    if intent.setting == "rural":
        clauses.append("p.is_rural = TRUE")
    elif intent.setting == "urban":
        clauses.append("p.is_urban = TRUE")
    return " AND ".join(clauses)


def sql_prefilter_node(intent: QueryIntent) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    started = time.perf_counter()
    where = _build_where(intent)
    sql = f"""
        SELECT p.facility_id
        FROM sanjeevani.silver.facilities_parsed p
        JOIN sanjeevani.gold.facility_embeddings g USING (facility_id)
        WHERE {where}
    """
    rows = query(sql)
    runtime_ms = int((time.perf_counter() - started) * 1000)
    candidate_ids = [r["facility_id"] for r in rows]
    yield tool_call(
        name="sql_prefilter",
        input=where,
        output_summary=f"{len(candidate_ids)} facilities matched",
        runtime_ms=runtime_ms,
        meta={"index": "state_geo_btree"},
    )
    yield ("done", {"candidate_ids": candidate_ids})
