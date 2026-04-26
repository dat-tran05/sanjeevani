"""SSE event taxonomy — the contract between agent and frontend.

Each event has a `type` and a `data` payload. Wire format: `data: {json}\n\n`.
"""
from __future__ import annotations

import json
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class EventType(str, Enum):
    THINKING_DELTA = "thinking_delta"
    AGENT_STEP_START = "agent_step_start"
    AGENT_STEP_END = "agent_step_end"
    TOOL_CALL = "tool_call"
    MODEL_PROPOSAL = "model_proposal"
    JURY_VERDICT = "jury_verdict"
    TIEBREAKER_RESOLVED = "tiebreaker_resolved"
    VALIDATOR_CHECK = "validator_check"
    RANKED_CARD = "ranked_card"
    CITATION = "citation"
    TEXT_DELTA = "text_delta"
    EXCLUSION = "exclusion"
    STREAM_COMPLETE = "stream_complete"
    ERROR = "error"


class StreamEvent(BaseModel):
    type: EventType
    data: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        payload = json.dumps({"type": self.type.value, "data": self.data})
        return f"data: {payload}\n\n"


def thinking(step_id: str, text: str) -> StreamEvent:
    return StreamEvent(type=EventType.THINKING_DELTA, data={"step_id": step_id, "text": text})


def agent_step_start(name: str, model: str | None = None, label: str = "") -> StreamEvent:
    data: dict[str, Any] = {"name": name, "label": label}
    if model:
        data["model"] = model
    return StreamEvent(type=EventType.AGENT_STEP_START, data=data)


def agent_step_end(name: str, latency_ms: int = 0, label: str = "", meta: dict | None = None) -> StreamEvent:
    data: dict[str, Any] = {"name": name, "latency_ms": latency_ms, "label": label}
    if meta:
        data["meta"] = meta
    return StreamEvent(type=EventType.AGENT_STEP_END, data=data)


def tool_call(name: str, input: Any, output_summary: str = "", runtime_ms: int = 0,
              meta: dict | None = None) -> StreamEvent:
    data: dict[str, Any] = {
        "name": name, "input": input, "output_summary": output_summary, "runtime_ms": runtime_ms,
    }
    if meta:
        data["meta"] = meta
    return StreamEvent(type=EventType.TOOL_CALL, data=data)


def model_proposal(slot: str, model: str, vendor: str, content: str) -> StreamEvent:
    return StreamEvent(type=EventType.MODEL_PROPOSAL, data={
        "slot": slot, "model": model, "vendor": vendor, "content": content,
    })


def jury_verdict(claim_id: str, claim_text: str, judges: list[dict],
                 agreement: dict, final_verdict: str) -> StreamEvent:
    return StreamEvent(type=EventType.JURY_VERDICT, data={
        "claim_id": claim_id, "claim_text": claim_text,
        "judges": judges, "agreement": agreement, "final_verdict": final_verdict,
    })


def tiebreaker_resolved(claim_id: str, model: str, rationale: str, final_verdict: str) -> StreamEvent:
    return StreamEvent(type=EventType.TIEBREAKER_RESOLVED, data={
        "claim_id": claim_id, "model": model, "rationale": rationale, "final_verdict": final_verdict,
    })


def validator_check(model: str, status: str, message: str,
                    broken_offsets: list | None = None) -> StreamEvent:
    data: dict[str, Any] = {"model": model, "status": status, "message": message}
    if broken_offsets:
        data["broken_offsets"] = broken_offsets
    return StreamEvent(type=EventType.VALIDATOR_CHECK, data=data)


def ranked_card(rank: int, facility_id: str, name: str, location: str,
                distance_km: float | None, type_: str, trust_score: float,
                prose: str, citation_ids: list[str], primary_claim_id: str,
                meta: dict | None = None) -> StreamEvent:
    data: dict[str, Any] = {
        "rank": rank, "facility_id": facility_id, "name": name, "location": location,
        "distance_km": distance_km, "type": type_, "trust_score": trust_score,
        "prose": prose, "citation_ids": citation_ids, "primary_claim_id": primary_claim_id,
    }
    if meta:
        data["meta"] = meta
    return StreamEvent(type=EventType.RANKED_CARD, data=data)


def citation(citation_id: str, facility_id: str, column: str, char_start: int,
             char_end: int, excerpt: str) -> StreamEvent:
    return StreamEvent(type=EventType.CITATION, data={
        "citation_id": citation_id, "facility_id": facility_id, "column": column,
        "char_start": char_start, "char_end": char_end, "excerpt": excerpt,
    })


def text(delta: str) -> StreamEvent:
    return StreamEvent(type=EventType.TEXT_DELTA, data={"text": delta})


def exclusion(facility_id: str, name: str, location: str, type_: str,
              reason: str, verdict: str) -> StreamEvent:
    return StreamEvent(type=EventType.EXCLUSION, data={
        "facility_id": facility_id, "name": name, "location": location, "type": type_,
        "reason": reason, "verdict": verdict,
    })


def stream_complete(recommendation_count: int, exclusion_count: int,
                    total_latency_ms: int) -> StreamEvent:
    return StreamEvent(type=EventType.STREAM_COMPLETE, data={
        "recommendation_count": recommendation_count,
        "exclusion_count": exclusion_count,
        "total_latency_ms": total_latency_ms,
    })


def error(message: str, stage: str | None = None) -> StreamEvent:
    data: dict[str, Any] = {"message": message}
    if stage:
        data["stage"] = stage
    return StreamEvent(type=EventType.ERROR, data=data)
