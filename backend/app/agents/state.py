"""Shared state passed between LangGraph nodes."""
from typing import TypedDict
from pydantic import BaseModel, Field


class PlannerOutput(BaseModel):
    prose: str = ""           # the streamed thinking text (concatenated)
    approach: str = ""        # short structured "how I'll attack this" hint


class QueryIntent(BaseModel):
    state: str | None = None
    region_code: str | None = None      # e.g., "BR" for Bihar
    setting: str | None = None          # 'rural' | 'urban' | None
    capability: str | None = None
    urgency: str | None = None          # 'emergent' | 'urgent' | 'routine' | None
    radius_km: int | None = None
    must_have: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    raw_query: str = ""


class RetrievedFacility(BaseModel):
    facility_id: str
    name: str
    state: str | None = None
    city: str | None = None
    description: str | None = None
    explicit_capabilities: list[str] = Field(default_factory=list)
    bm25_score: float = 0.0
    dense_score: float = 0.0
    rrf_score: float = 0.0


class RankedFacility(BaseModel):
    facility_id: str
    name: str
    state: str | None = None
    city: str | None = None
    description: str | None = None
    explicit_capabilities: list[str] = Field(default_factory=list)
    rerank_score: float = 0.0
    rerank_rationale: str = ""


class Claim(BaseModel):
    claim_id: str
    facility_id: str
    claim_type: str
    claim_text: str
    source_column: str
    char_start: int
    char_end: int


class Proposal(BaseModel):
    slot: str                           # "A" or "B"
    model: str
    vendor: str
    content: str                        # raw proposer rationale text
    ranking: list[str] = Field(default_factory=list)  # ordered facility_ids


class Citation(BaseModel):
    citation_id: str
    facility_id: str
    column: str
    char_start: int
    char_end: int
    excerpt: str


class Card(BaseModel):
    rank: int
    facility_id: str
    name: str
    location: str
    distance_km: float | None = None
    type: str
    prose: str                          # uses {{c1}}, {{c2}} markers
    citation_ids: list[str] = Field(default_factory=list)
    primary_claim_id: str
    trust_score: float = 0.0


class Excluded(BaseModel):
    facility_id: str
    name: str
    location: str
    type: str
    reason: str
    verdict: str                        # "unsupported" | "out_of_scope" | "low_trust"


class AggregatedRanking(BaseModel):
    top: list[Card] = Field(default_factory=list)
    excluded: list[Excluded] = Field(default_factory=list)
    prose: str = ""
    citations: list[Citation] = Field(default_factory=list)
    escalate_claims: list[str] = Field(default_factory=list)


class JudgeVerdict(BaseModel):
    model: str
    vendor: str
    verdict: str                        # "supported" | "partial" | "unsupported"
    confidence: float
    quote: str


class JuryVerdict(BaseModel):
    claim_id: str
    claim_text: str
    judges: list[JudgeVerdict]
    agreement_count: int
    dissent_count: int
    final_verdict: str
    facility_id: str = ""
    facility_name: str = ""


class Tiebreaker(BaseModel):
    claim_id: str
    model: str
    rationale: str
    final_verdict: str


class ValidatorResult(BaseModel):
    model: str
    status: str                         # "approved" | "flagged"
    message: str = ""
    broken_offsets: list[dict] = Field(default_factory=list)


class AgentState(TypedDict, total=False):
    query: str
    planner: PlannerOutput
    intent: QueryIntent
    candidate_ids: list[str]
    retrieved: list[RetrievedFacility]
    reranked: list[RankedFacility]
    proposals: dict[str, Proposal]
    aggregated: AggregatedRanking
    jury_results: list[JuryVerdict]
    tiebreaker_results: list[Tiebreaker]
    validator: ValidatorResult
    timings: dict[str, int]
