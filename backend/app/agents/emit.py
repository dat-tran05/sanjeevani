"""Emit node — streams cards, citations, prose, exclusions in the locked wire order.

Gates the chat-side output on validator approval. If validator flagged, cards
still emit but with meta={validator: 'flagged'}.
"""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, AggregatedRanking, JuryVerdict, ValidatorResult
from app.streaming.sse import (
    StreamEvent, ranked_card, citation, text, exclusion, stream_complete,
)


EXCLUSION_DELAY_S = 0.15
SYNTHESIZED_PROSE_CHUNK_S = 0.04


def _trust_score_for(card_primary_claim_id: str, jury_results: list[JuryVerdict]) -> float:
    for jv in jury_results:
        if jv.claim_id == card_primary_claim_id:
            if not jv.judges:
                return 0.0
            mean_conf = sum(j.confidence for j in jv.judges) / len(jv.judges)
            return round(mean_conf * (jv.agreement_count / 3.0), 2)
    return 0.0


def _flag_meta(validator: ValidatorResult | None) -> dict | None:
    if validator and validator.status == "flagged":
        return {"validator": "flagged"}
    return None


def emit_node(aggregated: AggregatedRanking,
              jury_results: list[JuryVerdict],
              validator: ValidatorResult | None,
              total_started_at: float) -> Iterator[StreamEvent]:
    flagged_meta = _flag_meta(validator)

    # 1. Cards
    for card in aggregated.top:
        ts = _trust_score_for(card.primary_claim_id, jury_results)
        meta = dict(flagged_meta or {})
        # Mark cards whose primary_claim has no jury data
        has_jury = any(jv.claim_id == card.primary_claim_id for jv in jury_results)
        if not has_jury:
            meta["jury"] = "not_pre_computed"
        yield ranked_card(
            rank=card.rank, facility_id=card.facility_id, name=card.name,
            location=card.location, distance_km=card.distance_km, type_=card.type,
            trust_score=ts, prose=card.prose, citation_ids=card.citation_ids,
            primary_claim_id=card.primary_claim_id, meta=meta or None,
        )

    # 2. Citations
    for cit in aggregated.citations:
        yield citation(
            citation_id=cit.citation_id, facility_id=cit.facility_id, column=cit.column,
            char_start=cit.char_start, char_end=cit.char_end, excerpt=cit.excerpt,
        )

    # 3. Synthesized prose, chunked for streaming feel
    prose = aggregated.prose
    chunk_size = 60  # roughly word-sized
    for i in range(0, len(prose), chunk_size):
        yield text(prose[i:i + chunk_size])
        time.sleep(SYNTHESIZED_PROSE_CHUNK_S)

    # 4. Exclusions live, with small delays
    for ex in aggregated.excluded:
        yield exclusion(
            facility_id=ex.facility_id, name=ex.name, location=ex.location,
            type_=ex.type, reason=ex.reason, verdict=ex.verdict,
        )
        time.sleep(EXCLUSION_DELAY_S)

    # 5. Stream complete
    total_ms = int((time.perf_counter() - total_started_at) * 1000)
    yield stream_complete(
        recommendation_count=len(aggregated.top),
        exclusion_count=len(aggregated.excluded),
        total_latency_ms=total_ms,
    )
