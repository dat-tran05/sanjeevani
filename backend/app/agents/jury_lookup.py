"""Jury lookup node — fetch pre-computed verdicts from gold.trust_verdicts.

Replays them as jury_verdict events with 200-400ms artificial delays so the
trace UI animates instead of dumping all judges at once.
"""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, AggregatedRanking, JudgeVerdict, JuryVerdict
from app.data.databricks_sql import query
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end, tool_call, jury_verdict


REPLAY_DELAY_S = 0.30  # per claim, between events


def _pick_final_verdict(judges: list[JudgeVerdict]) -> tuple[str, int, int]:
    counts = {"supported": 0, "partial": 0, "unsupported": 0}
    for j in judges:
        if j.verdict in counts:
            counts[j.verdict] += 1
    if counts["supported"] == 3:
        return "supported", 3, 0
    if counts["unsupported"] == 3:
        return "unsupported", 0, 3
    if counts["partial"] == 3:
        return "partial", 3, 0
    if counts["supported"] >= 2:
        return "supported", counts["supported"], 3 - counts["supported"]
    if counts["unsupported"] >= 2:
        return "unsupported", 3 - counts["unsupported"], counts["unsupported"]
    return "partial", 1, 2  # 1-1-1


def jury_lookup_node(aggregated: AggregatedRanking
                     ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("jury_lookup", label="Verifiable Consensus · jury verdicts")
    started = time.perf_counter()

    claim_ids = [c.primary_claim_id for c in aggregated.top if c.primary_claim_id] \
              + [cid for cid in aggregated.escalate_claims]
    claim_ids = list(dict.fromkeys(claim_ids))  # dedupe, preserve order

    if not claim_ids:
        yield tool_call("lookup_jury_verdicts", input={"claim_ids": []},
                        output_summary="0 verdicts retrieved", runtime_ms=0)
        yield agent_step_end("jury_lookup", latency_ms=int((time.perf_counter() - started) * 1000))
        yield ("done", {"jury_results": []})
        return

    placeholders = ", ".join(f"'{c}'" for c in claim_ids)
    sql_started = time.perf_counter()
    rows = query(f"""
        SELECT v.claim_id, v.judge_model, v.judge_vendor, v.verdict, v.confidence, v.quote,
               c.claim_text, c.facility_id, p.name AS facility_name
        FROM sanjeevani.gold.trust_verdicts v
        JOIN sanjeevani.silver.facility_claims c USING (claim_id)
        LEFT JOIN sanjeevani.silver.facilities_parsed p ON p.facility_id = c.facility_id
        WHERE v.claim_id IN ({placeholders})
        ORDER BY v.claim_id, v.judge_model
    """)
    sql_ms = int((time.perf_counter() - sql_started) * 1000)
    yield tool_call(
        name="lookup_jury_verdicts",
        input={"claim_ids": claim_ids},
        output_summary=f"{len(rows)} verdicts retrieved",
        runtime_ms=sql_ms,
    )

    by_claim: dict[str, dict] = {}
    for r in rows:
        cid = r["claim_id"]
        entry = by_claim.setdefault(cid, {
            "claim_text": r["claim_text"],
            "facility_id": r.get("facility_id") or "",
            "facility_name": r.get("facility_name") or "",
            "judges": [],
        })
        entry["judges"].append(JudgeVerdict(
            model=r["judge_model"], vendor=r["judge_vendor"],
            verdict=r["verdict"], confidence=float(r["confidence"]),
            quote=r["quote"] or "",
        ))

    jury_results: list[JuryVerdict] = []
    for cid in claim_ids:
        entry = by_claim.get(cid)
        if not entry or len(entry["judges"]) == 0:
            continue
        judges = entry["judges"]
        final, agree, dissent = _pick_final_verdict(judges)
        jv = JuryVerdict(
            claim_id=cid, claim_text=entry["claim_text"], judges=judges,
            agreement_count=agree, dissent_count=dissent, final_verdict=final,
            facility_id=entry["facility_id"], facility_name=entry["facility_name"],
        )
        jury_results.append(jv)
        # Emit, then sleep so the trace animates
        yield jury_verdict(
            claim_id=jv.claim_id, claim_text=jv.claim_text,
            judges=[j.model_dump() for j in jv.judges],
            agreement={"agree": jv.agreement_count, "dissent": jv.dissent_count},
            final_verdict=jv.final_verdict,
            facility_id=jv.facility_id, facility_name=jv.facility_name,
        )
        time.sleep(REPLAY_DELAY_S)

    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("jury_lookup", latency_ms=latency)
    yield ("done", {"jury_results": jury_results})
