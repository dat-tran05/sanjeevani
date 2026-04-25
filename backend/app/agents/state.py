"""Shared state passed between LangGraph nodes."""
from typing import TypedDict
from pydantic import BaseModel


class QueryIntent(BaseModel):
    state: str | None = None
    setting: str | None = None  # 'rural' | 'urban' | None
    capability: str | None = None
    raw_query: str = ""


class RetrievedFacility(BaseModel):
    facility_id: str
    name: str
    state: str | None
    city: str | None
    description: str | None
    explicit_capabilities: list[str] = []
    similarity: float = 0.0


class AgentState(TypedDict, total=False):
    query: str
    intent: QueryIntent
    candidates: list[RetrievedFacility]
    answer: str
