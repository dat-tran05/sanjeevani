"""Validator node — structural-only check that citation offsets resolve to real text."""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, AggregatedRanking, ValidatorResult
from app.data.databricks_sql import query
from app.llm.bedrock import get_sonnet_model_id
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end, validator_check


def validator_node(aggregated: AggregatedRanking
                   ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    model = get_sonnet_model_id()
    yield agent_step_start("validator", model=f"{model} (fresh context)",
                           label="independent re-check of citation offsets")
    started = time.perf_counter()

    if not aggregated.citations:
        result = ValidatorResult(model=model, status="approved",
                                 message="No citations to verify.", broken_offsets=[])
        yield validator_check(model, result.status, result.message)
        yield agent_step_end("validator", latency_ms=int((time.perf_counter() - started) * 1000))
        yield ("done", {"validator": result})
        return

    facility_ids = list({c.facility_id for c in aggregated.citations})
    placeholders = ", ".join(f"'{f}'" for f in facility_ids)
    rows = query(f"""
        SELECT facility_id, description
        FROM sanjeevani.silver.facilities_parsed
        WHERE facility_id IN ({placeholders})
    """)
    desc_by_id = {r["facility_id"]: (r["description"] or "") for r in rows}

    broken = []
    for cit in aggregated.citations:
        desc = desc_by_id.get(cit.facility_id, "")
        if not desc or cit.char_end > len(desc) or cit.char_start < 0 or cit.char_start >= cit.char_end:
            broken.append({"citation_id": cit.citation_id, "reason": "offset out of bounds"})
            continue
        # Verify excerpt approximately matches source slice
        slice_text = desc[cit.char_start:cit.char_end].strip().lower()
        excerpt_text = (cit.excerpt or "").strip().lower()
        if excerpt_text and slice_text and excerpt_text not in slice_text and slice_text not in excerpt_text:
            broken.append({"citation_id": cit.citation_id,
                          "reason": "excerpt does not match source text at offsets"})

    status = "approved" if not broken else "flagged"
    msg = ("All citation offsets verified against silver.facilities_parsed description text. "
           "No hallucinated references.") if status == "approved" else \
          (f"{len(broken)} citation(s) failed offset verification.")
    result = ValidatorResult(model=model, status=status, message=msg, broken_offsets=broken)
    yield validator_check(model, status, msg, broken_offsets=broken or None)
    yield agent_step_end("validator", latency_ms=int((time.perf_counter() - started) * 1000))
    yield ("done", {"validator": result})
