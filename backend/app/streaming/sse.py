"""SSE event taxonomy — the contract between agent and frontend.

Each event has a `type` and a `data` payload. Wire format: `data: {json}\n\n`.
"""
from __future__ import annotations

import json
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class EventType(str, Enum):
    THINKING_DELTA = "thinking_delta"          # Claude extended-thinking tokens
    AGENT_STEP_START = "agent_step_start"      # LangGraph node entry
    AGENT_STEP_END = "agent_step_end"          # LangGraph node exit
    TOOL_CALL = "tool_call"                    # tool invocation inside a node
    MODEL_PROPOSAL = "model_proposal"          # juror proposes (MoA mode, future)
    CONSENSUS_RESOLVED = "consensus_resolved"  # aggregator/jury verdict (future)
    TEXT_DELTA = "text_delta"                  # final answer tokens
    CITATION = "citation"                      # cited row + char offsets
    ERROR = "error"


class StreamEvent(BaseModel):
    type: EventType
    data: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        """Format as a single SSE message frame."""
        payload = json.dumps({"type": self.type.value, "data": self.data})
        return f"data: {payload}\n\n"


# Convenience constructors
def thinking(text: str) -> StreamEvent:
    return StreamEvent(type=EventType.THINKING_DELTA, data={"text": text})


def agent_step_start(name: str, summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.AGENT_STEP_START, data={"name": name, "summary": summary})


def agent_step_end(name: str, summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.AGENT_STEP_END, data={"name": name, "summary": summary})


def tool_call(name: str, input: Any, output_summary: str = "") -> StreamEvent:
    return StreamEvent(type=EventType.TOOL_CALL, data={
        "name": name, "input": input, "output_summary": output_summary,
    })


def text(delta: str) -> StreamEvent:
    return StreamEvent(type=EventType.TEXT_DELTA, data={"text": delta})


def citation(facility_id: str, column: str, char_start: int, char_end: int, excerpt: str) -> StreamEvent:
    return StreamEvent(type=EventType.CITATION, data={
        "facility_id": facility_id,
        "column": column,
        "char_start": char_start,
        "char_end": char_end,
        "excerpt": excerpt,
    })


def error(message: str) -> StreamEvent:
    return StreamEvent(type=EventType.ERROR, data={"message": message})
