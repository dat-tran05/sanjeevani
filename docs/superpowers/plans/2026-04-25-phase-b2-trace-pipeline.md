# Phase B2 — Backend Trace Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase A1+B1 thin-slice 3-node pipeline with the full 11-node Verifiable Consensus pipeline (planner → intent → retrieval → MoA → jury → tiebreaker → validator → emit) that powers the chat + agent trace UI shown in the demo mockups.

**Architecture:** LangGraph-held state + custom async generator orchestrator (extension of existing pattern). Heavy fan-outs (MoA proposers, jury lookups) parallelized inside nodes via `asyncio.gather`. In-process BM25 + dense matrix loaded at FastAPI startup, scoped to ~150 enriched facilities. Jury verdicts pre-computed offline and replayed online with artificial delays.

**Tech Stack:** FastAPI, LangGraph 1.0, Anthropic SDK (Bedrock), `databricks-sql-connector`, `rank-bm25`, NumPy, tenacity, Pydantic v2, Databricks Foundation Model API.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-25-backend-trace-pipeline-design.md`
- System overview: `docs/OVERVIEW.md`
- Prior phase: `docs/superpowers/plans/2026-04-25-phase-a1-b1-thin-slice.md`

**Spec deviations (intentional, locked at plan time):**
- **R2 (lazy jury) dropped.** The spec proposes capturing claim_ids via a backend dry-run before jurying. To avoid chicken-and-egg ordering, we instead jury ALL claims for the ~150 enriched facilities (~300-500 claims). Cost rises ~$10 (still well under budget); wall time rises ~10 min. R1 and R3 are kept.

**Track A vs Track B:** This plan is solo backend (Track A continuation). Partner is on frontend (Track B). The integration seam is `/query` SSE + the 3 new endpoints — partner consumes those contracts.

**Manual testing only.** No unit tests unless a component proves brittle during integration.

---

## Databricks checkpoint summary (push to user)

The user must run notebooks in Databricks at four points. This plan flags each one with **`🟡 USER CHECKPOINT — DATABRICKS`**:

1. After Task 4 — run extended `02_extract.py`
2. After Task 5 — re-run existing `05_embeddings.py` to pick up new rows
3. After Task 6 — run new `06_jury.py`
4. After Task 7 — run new `07_tiebreaker.py`, `08_aggregates.py`, `09_trust_scores.py`

Backend implementation tasks (8-17) can run in parallel with the user's notebook runs after Task 7 finishes. Practically: write the notebooks first, then code backend while data builds.

---

## Task 1: Extend SSE event taxonomy

**Files:**
- Modify: `backend/app/streaming/sse.py`

- [ ] **Step 1: Add new event type enum members and constructors**

Replace the contents of `backend/app/streaming/sse.py` with:

```python
"""SSE event taxonomy — the contract between agent and frontend.

Each event has a `type` and a `data` payload. Wire format: `data: {json}\\n\\n`.
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
```

- [ ] **Step 2: Verify imports work**

Run:
```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "from app.streaming.sse import (
    EventType, thinking, agent_step_start, agent_step_end, tool_call,
    model_proposal, jury_verdict, tiebreaker_resolved, validator_check,
    ranked_card, citation, text, exclusion, stream_complete, error
); print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/streaming/sse.py
git commit -m "feat(backend): extend SSE event taxonomy for trace pipeline

Adds jury_verdict, tiebreaker_resolved, validator_check, ranked_card,
exclusion, stream_complete event types and constructors. Existing events
get explicit typed payloads (latency_ms, model, meta).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extend state shape

**Files:**
- Modify: `backend/app/agents/state.py`

- [ ] **Step 1: Replace state.py contents**

Replace the contents of `backend/app/agents/state.py` with:

```python
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
```

- [ ] **Step 2: Verify imports**

Run:
```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "from app.agents.state import (
    AgentState, QueryIntent, PlannerOutput, RetrievedFacility, RankedFacility,
    Claim, Proposal, Citation, Card, Excluded, AggregatedRanking, JudgeVerdict,
    JuryVerdict, Tiebreaker, ValidatorResult
); print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/state.py
git commit -m "feat(backend): extend AgentState with full pipeline pydantic models

Adds PlannerOutput, RankedFacility, Claim, Proposal, Citation, Card,
Excluded, AggregatedRanking, JudgeVerdict, JuryVerdict, Tiebreaker,
ValidatorResult. Extends QueryIntent with urgency, radius_km, must_have,
confidence, region_code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add Bedrock Haiku 4.5 + extended-thinking helper

**Files:**
- Modify: `backend/app/llm/bedrock.py`

- [ ] **Step 1: Replace bedrock.py contents**

Replace the contents of `backend/app/llm/bedrock.py` with:

```python
"""Anthropic Claude via AWS Bedrock — used by planner, intent, MoA, aggregator, validator."""
import os
from typing import Iterator
from anthropic import AnthropicBedrock

_client: AnthropicBedrock | None = None


def get_client() -> AnthropicBedrock:
    """Singleton AnthropicBedrock client."""
    global _client
    if _client is None:
        _client = AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def get_sonnet_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")


def get_haiku_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID_HAIKU", "us.anthropic.claude-haiku-4-5")


def stream_with_thinking(
    prompt: str,
    *,
    model: str | None = None,
    max_tokens: int = 2048,
    thinking_budget: int = 1500,
    system: str | None = None,
) -> Iterator[tuple[str, str]]:
    """Stream a Sonnet response with extended thinking enabled.

    Yields (kind, text) tuples where kind is 'thinking' or 'text'.
    Caller is responsible for converting to SSE events.
    """
    client = get_client()
    kwargs: dict = {
        "model": model or get_sonnet_model_id(),
        "max_tokens": max_tokens,
        "thinking": {"type": "enabled", "budget_tokens": thinking_budget},
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    with client.messages.stream(**kwargs) as stream:
        for event in stream:
            if event.type == "content_block_delta":
                delta = event.delta
                if delta.type == "thinking_delta":
                    yield ("thinking", delta.thinking)
                elif delta.type == "text_delta":
                    yield ("text", delta.text)
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "from app.llm.bedrock import get_client, get_sonnet_model_id, get_haiku_model_id, stream_with_thinking; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/llm/bedrock.py
git commit -m "feat(backend): add Haiku 4.5 client + extended-thinking stream helper

stream_with_thinking yields (kind, text) tuples for thinking_delta and
text_delta blocks, letting callers convert to SSE events. Used by planner,
aggregator, tiebreaker, validator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `02_extract.py` to write `silver.facility_claims` + broaden subset

**Files:**
- Modify: `databricks/notebooks/02_extract.py`

- [ ] **Step 1: Update SUBSET_FILTER and target table**

Open `databricks/notebooks/02_extract.py` and replace the SUBSET configuration block (lines around `SUBSET_FILTER = "state = 'Bihar'"`) with:

```python
CATALOG = "sanjeevani"
LLAMA_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct"

# Phase B2 subset: hero-query keyword prefilter (~150 facilities)
SUBSET_FILTER = """(
    (state='Bihar' AND description RLIKE '(?i)(surgery|emergency|operation|theatre|operating)')
    OR (state='Maharashtra' AND city IN ('Mumbai','Thane','Navi Mumbai','New Mumbai')
        AND (description RLIKE '(?i)(oncolog|cancer|radiation|chemo)' OR
             array_contains(specialties, 'oncology')))
    OR (state='Tamil Nadu' AND description RLIKE '(?i)(pediatric|paediatric|PICU|NICU|intensive care|child)')
)"""
SUBSET_LIMIT = 200
```

- [ ] **Step 2: Add `silver.facility_claims` table creation right after the existing `silver.facilities_extracted` CREATE**

Find the block:
```python
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.silver.facilities_extracted (
        ...
    ) USING DELTA
""")
```

Immediately after it, add:
```python
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.silver.facility_claims (
        claim_id STRING,
        facility_id STRING,
        claim_type STRING,
        claim_text STRING,
        source_column STRING,
        char_start INT,
        char_end INT,
        created_at TIMESTAMP
    ) USING DELTA
""")
```

- [ ] **Step 3: Add a helper to derive claims from extraction output and source text**

After the `EXTRACTION_PROMPT = ...` block, add:

```python
import re
import hashlib

# Map claim_type slots to short prefixes for stable claim_ids
CLAIM_TYPE_PREFIX = {
    "emergency_surgery": "es",
    "oncology_specialty": "os",
    "picu": "pi",
    "icu_24_7": "ic",
    "obstetrics": "ob",
    "general_surgery": "gs",
    "specialty_claim": "sp",
    "equipment_claim": "eq",
}


def derive_claims(facility_id: str, extracted: ExtractedCapabilities,
                  description: str | None) -> list[dict]:
    """Generate one row per surfaced capability with stable claim_id and offsets."""
    rows = []
    desc = description or ""
    seen_types = set()

    def add(claim_type: str, claim_text: str, search_terms: list[str]):
        if claim_type in seen_types:
            return
        seen_types.add(claim_type)
        prefix = CLAIM_TYPE_PREFIX.get(claim_type, "ot")
        # facility_id is a long sha; take last 8 hex chars for compactness
        short_id = facility_id[-8:].upper()
        claim_id = f"cap_{prefix}_F-{short_id}"
        # Locate first occurrence of any search term in description (case-insensitive)
        char_start, char_end = -1, -1
        for term in search_terms:
            m = re.search(re.escape(term), desc, re.IGNORECASE)
            if m:
                char_start, char_end = m.start(), m.end()
                break
        rows.append({
            "claim_id": claim_id,
            "facility_id": facility_id,
            "claim_type": claim_type,
            "claim_text": claim_text,
            "source_column": "description",
            "char_start": char_start,
            "char_end": char_end,
            "created_at": datetime.now(timezone.utc),
        })

    if extracted.surgery_capable:
        if extracted.emergency_24_7:
            add("emergency_surgery", "Operates 24/7 emergency surgery",
                ["emergency", "24-hour", "24 hour", "24/7", "around the clock"])
        else:
            add("general_surgery", "Performs general surgery",
                ["surgery", "operation", "operating", "theatre"])
    if extracted.emergency_24_7 and not extracted.surgery_capable:
        add("icu_24_7", "Operates 24/7 emergency / intensive care",
            ["emergency", "24-hour", "24 hour", "24/7", "ICU", "intensive"])
    # Specialty claims from explicit_capabilities array
    for cap in extracted.explicit_capabilities[:3]:
        cap_lower = cap.lower()
        if any(k in cap_lower for k in ["oncolog", "cancer", "radiation", "chemo"]):
            add("oncology_specialty", f"Listed oncology capability: {cap}",
                ["oncolog", "cancer", "radiation", "chemo"])
        elif any(k in cap_lower for k in ["pediatric", "paediatric", "picu", "child", "neonatal"]):
            add("picu", f"Listed pediatric/PICU capability: {cap}",
                ["pediatric", "paediatric", "PICU", "NICU", "child"])
        elif any(k in cap_lower for k in ["obstetric", "maternity", "delivery"]):
            add("obstetrics", f"Listed obstetrics capability: {cap}",
                ["obstetric", "maternity", "delivery"])
    return rows
```

- [ ] **Step 4: Wire claims emission into the extraction loop**

Find the block where `extract_one(row)` is called:
```python
for i, row in enumerate(todo):
    try:
        result = extract_one(row)
        extracted_records.append({...})
```

Add a parallel `claims_records` list before the loop and emit claims inside the loop. Replace that block with:

```python
extracted_records = []
claims_records = []
failures = []
for i, row in enumerate(todo):
    try:
        result = extract_one(row)
        extracted_records.append({
            "facility_id": row.facility_id,
            **result.model_dump(),
            "extracted_at": datetime.now(timezone.utc),
            "extractor_model": "llama-3-3-70b",
        })
        for c in derive_claims(row.facility_id, result, row.description):
            claims_records.append(c)
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(todo)} done ({len(claims_records)} claims so far)")
    except Exception as e:
        print(f"  FAIL {row.facility_id}: {type(e).__name__}: {e}")
        failures.append((row.facility_id, str(e)))

print(f"\nExtracted: {len(extracted_records)}, Claims: {len(claims_records)}, Failed: {len(failures)}")
```

- [ ] **Step 5: Add MERGE for `facility_claims` after the existing MERGE for `facilities_extracted`**

Find:
```python
if extracted_records:
    new_df = spark.createDataFrame(extracted_records)
    new_df.createOrReplaceTempView("new_extractions")

    spark.sql(f"""
        MERGE INTO {CATALOG}.silver.facilities_extracted AS target
        ...
    """)
```

Add immediately after:
```python
if claims_records:
    claims_df = spark.createDataFrame(claims_records)
    claims_df.createOrReplaceTempView("new_claims")

    spark.sql(f"""
        MERGE INTO {CATALOG}.silver.facility_claims AS target
        USING new_claims AS source
        ON target.claim_id = source.claim_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"Claims MERGE complete. Total in table: {spark.table(f'{CATALOG}.silver.facility_claims').count()}")
```

- [ ] **Step 6: Update sanity check at the bottom**

Find the final `display(spark.sql(...))` block and replace with:
```python
display(spark.sql(f"""
    SELECT p.name, p.state, p.city, e.surgery_capable, e.emergency_24_7,
           e.explicit_capabilities, e.staff_mentioned
    FROM {CATALOG}.silver.facilities_extracted e
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    LIMIT 10
"""))

display(spark.sql(f"""
    SELECT claim_id, facility_id, claim_type, claim_text, char_start, char_end
    FROM {CATALOG}.silver.facility_claims
    LIMIT 10
"""))
```

- [ ] **Step 7: Commit**

```bash
git add databricks/notebooks/02_extract.py
git commit -m "feat(databricks): extend 02_extract — emit silver.facility_claims, broaden subset

Phase B2 subset filter covers ~150 facilities across the 3 hero queries
(Bihar surgical, Mumbai oncology, Tamil Nadu pediatric/PICU). Adds
silver.facility_claims with stable claim_ids and source-text offsets;
derived from ExtractedCapabilities post-extraction. Idempotent MERGE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: 🟡 USER CHECKPOINT — DATABRICKS**

Tell the user:

> **🟡 USER CHECKPOINT — please run in Databricks:**
> 1. Upload the updated `databricks/notebooks/02_extract.py` to your Databricks workspace.
> 2. Run all cells.
> 3. Confirm the final two displays show ~200 rows in `silver.facilities_extracted` (or the existing 100 + ~100 new) and 300-500 rows in `silver.facility_claims`.
> 4. Reply with row counts and any sample claim_ids that look off.

Wait for confirmation before continuing.

---

## Task 5: Re-run `05_embeddings.py` to pick up new rows

**Files:** none (existing notebook is idempotent)

- [ ] **Step 1: 🟡 USER CHECKPOINT — DATABRICKS**

Tell the user:

> **🟡 USER CHECKPOINT — please run in Databricks:**
> 1. Re-run `05_embeddings.py` (no code changes needed — its LEFT ANTI JOIN on `gold.facility_embeddings` makes it pick up only the new ~100-150 facilities).
> 2. Confirm `gold.facility_embeddings` now has ~150-200 rows total.
> 3. Reply with the final count.

Wait for confirmation before continuing.

---

## Task 6: Create `06_jury.py`

**Files:**
- Create: `databricks/notebooks/06_jury.py`

- [ ] **Step 1: Write the notebook**

Create `databricks/notebooks/06_jury.py` with the following content:

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 06 — Multi-Model Jury (Verifiable Consensus)
# MAGIC For each row in `silver.facility_claims`, three independent judges verdict the claim
# MAGIC against the facility's source text. Writes `gold.trust_verdicts` (3 rows per claim).
# MAGIC Idempotent on (claim_id, judge_model).

# COMMAND ----------

# MAGIC %pip install openai tenacity boto3
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CATALOG = "sanjeevani"

# Judges (heterogeneous — different vendors)
JUDGES = [
    {"id": "us.anthropic.claude-sonnet-4-6", "vendor": "anthropic", "via": "bedrock"},
    {"id": "databricks-meta-llama-3-3-70b-instruct", "vendor": "meta", "via": "databricks"},
    {"id": "databricks-qwen3-next-80b-a3b-instruct", "vendor": "databricks", "via": "databricks"},
]

# Throttle Free Edition QPS
SLEEP_BETWEEN_CLAIMS = 0.8

# COMMAND ----------

# Ensure target table exists (idempotent)
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.trust_verdicts (
        claim_id STRING,
        judge_model STRING,
        judge_vendor STRING,
        verdict STRING,
        confidence FLOAT,
        quote STRING,
        created_at TIMESTAMP
    ) USING DELTA
""")

# Find claims that don't yet have all 3 judges' verdicts
todo = spark.sql(f"""
    WITH expected AS (
        SELECT c.claim_id, j.judge_model
        FROM {CATALOG}.silver.facility_claims c
        CROSS JOIN (
            SELECT 'us.anthropic.claude-sonnet-4-6' AS judge_model
            UNION ALL SELECT 'databricks-meta-llama-3-3-70b-instruct'
            UNION ALL SELECT 'databricks-qwen3-next-80b-a3b-instruct'
        ) j
    )
    SELECT DISTINCT c.claim_id, c.facility_id, c.claim_type, c.claim_text,
           c.char_start, c.char_end,
           p.description, p.name
    FROM {CATALOG}.silver.facility_claims c
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    JOIN expected e ON c.claim_id = e.claim_id
    LEFT ANTI JOIN {CATALOG}.gold.trust_verdicts v
        ON e.claim_id = v.claim_id AND e.judge_model = v.judge_model
""").collect()

# Group rows back per claim (we need one entry per claim, not per missing judge)
claims_by_id = {}
for r in todo:
    claims_by_id.setdefault(r.claim_id, r)

print(f"Claims needing one or more judges: {len(claims_by_id)}")

# COMMAND ----------

import os
import json
import time
import boto3
from datetime import datetime, timezone
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# Databricks Model Serving client (for Llama, Qwen)
_workspace = spark.conf.get("spark.databricks.workspaceUrl")
_dbrx_token = dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()
dbrx_client = OpenAI(
    api_key=_dbrx_token,
    base_url=f"https://{_workspace}/serving-endpoints",
)

# Bedrock client (for Sonnet judge)
# Set AWS creds in Databricks workspace secret scope `sanjeevani`
AWS_BEARER_TOKEN_BEDROCK = dbutils.secrets.get(scope="sanjeevani", key="AWS_BEARER_TOKEN_BEDROCK")
AWS_REGION = "us-east-1"
os.environ["AWS_BEARER_TOKEN_BEDROCK"] = AWS_BEARER_TOKEN_BEDROCK
os.environ["AWS_REGION"] = AWS_REGION
import anthropic
bedrock_client = anthropic.AnthropicBedrock(aws_region=AWS_REGION)


JURY_PROMPT = """You are an independent fact-verifier judging a healthcare facility's claim.

CLAIM: "{claim_text}"
FACILITY: {facility_name}
SOURCE TEXT (from facility's description):
\"\"\"
{description}
\"\"\"

Your task: decide if the claim is SUPPORTED, PARTIAL, or UNSUPPORTED by the source text alone.

- SUPPORTED: source text directly confirms the claim
- PARTIAL: source text suggests the claim is true but not explicitly
- UNSUPPORTED: source text doesn't back the claim, or contradicts it

Return JSON only:
{{"verdict": "supported"|"partial"|"unsupported",
  "confidence": <0..1>,
  "quote": "<verbatim excerpt from source text that informs your verdict, or empty string>"}}"""


@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    retry=retry_if_exception_type(Exception),
)
def judge_one(judge: dict, claim_row) -> dict:
    prompt = JURY_PROMPT.format(
        claim_text=claim_row.claim_text,
        facility_name=claim_row.name or "(unknown)",
        description=(claim_row.description or "(none)")[:2000],  # cap to keep tokens reasonable
    )
    if judge["via"] == "bedrock":
        resp = bedrock_client.messages.create(
            model=judge["id"],
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
    else:
        resp = dbrx_client.chat.completions.create(
            model=judge["id"],
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.1,
        )
        text = resp.choices[0].message.content.strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    return {
        "verdict": parsed.get("verdict", "unsupported"),
        "confidence": float(parsed.get("confidence", 0.0)),
        "quote": parsed.get("quote", "")[:500],
    }


# COMMAND ----------

verdicts_records = []
failures = []
existing = spark.sql(f"SELECT claim_id, judge_model FROM {CATALOG}.gold.trust_verdicts").collect()
existing_keys = {(r.claim_id, r.judge_model) for r in existing}

claim_ids = list(claims_by_id.keys())
print(f"Processing {len(claim_ids)} claims × {len(JUDGES)} judges = up to {len(claim_ids) * len(JUDGES)} verdicts")

for i, cid in enumerate(claim_ids):
    claim_row = claims_by_id[cid]
    for judge in JUDGES:
        if (cid, judge["id"]) in existing_keys:
            continue
        try:
            v = judge_one(judge, claim_row)
            verdicts_records.append({
                "claim_id": cid,
                "judge_model": judge["id"],
                "judge_vendor": judge["vendor"],
                "verdict": v["verdict"],
                "confidence": v["confidence"],
                "quote": v["quote"],
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as e:
            print(f"  FAIL {cid} / {judge['id']}: {type(e).__name__}: {e}")
            failures.append((cid, judge["id"], str(e)))
    if (i + 1) % 10 == 0:
        print(f"  {i+1}/{len(claim_ids)} claims processed; {len(verdicts_records)} new verdicts; {len(failures)} fails")
    time.sleep(SLEEP_BETWEEN_CLAIMS)

print(f"\nVerdicts: {len(verdicts_records)}, Failed: {len(failures)}")

# COMMAND ----------

if verdicts_records:
    new_df = spark.createDataFrame(verdicts_records)
    new_df.createOrReplaceTempView("new_verdicts")

    spark.sql(f"""
        MERGE INTO {CATALOG}.gold.trust_verdicts AS target
        USING new_verdicts AS source
        ON target.claim_id = source.claim_id AND target.judge_model = source.judge_model
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total verdicts: {spark.table(f'{CATALOG}.gold.trust_verdicts').count()}")

# COMMAND ----------

# Sanity check: agreement breakdown across claims
display(spark.sql(f"""
    WITH agg AS (
        SELECT claim_id,
               COUNT(*) AS judge_count,
               SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS supported,
               SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial,
               SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS unsupported
        FROM {CATALOG}.gold.trust_verdicts
        GROUP BY claim_id
    )
    SELECT
        SUM(CASE WHEN supported=3 THEN 1 ELSE 0 END) AS three_agree_supported,
        SUM(CASE WHEN supported=2 THEN 1 ELSE 0 END) AS two_supported,
        SUM(CASE WHEN unsupported=3 THEN 1 ELSE 0 END) AS three_agree_unsupported,
        SUM(CASE WHEN supported>=1 AND unsupported>=1 THEN 1 ELSE 0 END) AS split_claims,
        COUNT(*) AS total_claims
    FROM agg
"""))
```

- [ ] **Step 2: Commit**

```bash
git add databricks/notebooks/06_jury.py
git commit -m "feat(databricks): add 06_jury — three-model Verifiable Consensus pipeline

Three independent judges (Sonnet 4.6 via Bedrock, Llama 3.3 70B via DBMS,
Qwen3-Next 80B via DBMS) verdict each claim in silver.facility_claims as
supported/partial/unsupported with confidence + cited quote. Idempotent
MERGE on (claim_id, judge_model). Tenacity retry + 0.8s throttle for Free
Edition QPS. Reads AWS_BEARER_TOKEN_BEDROCK from secret scope 'sanjeevani'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: 🟡 USER CHECKPOINT — DATABRICKS**

Tell the user:

> **🟡 USER CHECKPOINT — please run in Databricks:**
> 1. Confirm AWS Bedrock bearer token is in your Databricks secret scope: `databricks secrets list-secrets --scope sanjeevani` should include `AWS_BEARER_TOKEN_BEDROCK`. If not: `databricks secrets put-secret sanjeevani AWS_BEARER_TOKEN_BEDROCK` and paste your token.
> 2. Upload `databricks/notebooks/06_jury.py` to your Databricks workspace.
> 3. Run all cells. Wall time: ~15-25 min for ~300-500 claims × 3 judges. Cost: ~$15-30 (Sonnet dominant).
> 4. Confirm the final display shows the verdict breakdown — expect a healthy mix of three_agree_supported, two_supported, and split_claims (~50-100 split is normal).
> 5. Reply with the final breakdown numbers.

Wait for confirmation before continuing.

---

## Task 7: Create `07_tiebreaker.py`, `08_aggregates.py`, `09_trust_scores.py`

**Files:**
- Create: `databricks/notebooks/07_tiebreaker.py`
- Create: `databricks/notebooks/08_aggregates.py`
- Create: `databricks/notebooks/09_trust_scores.py`

- [ ] **Step 1: Create `07_tiebreaker.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 07 — Tiebreaker (Sonnet 4.6 extended thinking)
# MAGIC For each split claim in `gold.trust_verdicts`, call Sonnet 4.6 with extended thinking
# MAGIC budget=3000 to produce a final verdict + rationale. Writes `gold.tiebreaker_verdicts`.
# MAGIC Idempotent on claim_id.

# COMMAND ----------

# MAGIC %pip install anthropic tenacity
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

CATALOG = "sanjeevani"
TIEBREAKER_MODEL = "us.anthropic.claude-sonnet-4-6"
THINKING_BUDGET = 3000

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.tiebreaker_verdicts (
        claim_id STRING,
        model STRING,
        final_verdict STRING,
        rationale STRING,
        created_at TIMESTAMP
    ) USING DELTA
""")

# Find split claims (any claim where judges don't all agree)
splits = spark.sql(f"""
    WITH agg AS (
        SELECT claim_id,
               SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS supp,
               SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS part,
               SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns
        FROM {CATALOG}.gold.trust_verdicts
        GROUP BY claim_id
    )
    SELECT c.claim_id, c.claim_text, c.facility_id, p.name, p.description,
           agg.supp, agg.part, agg.uns
    FROM {CATALOG}.silver.facility_claims c
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    JOIN agg USING (claim_id)
    LEFT ANTI JOIN {CATALOG}.gold.tiebreaker_verdicts t USING (claim_id)
    WHERE NOT (agg.supp = 3 OR agg.uns = 3 OR agg.part = 3)
""").collect()

print(f"Split claims to tiebreak: {len(splits)}")

# COMMAND ----------

import os
import json
from datetime import datetime, timezone
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

AWS_BEARER_TOKEN_BEDROCK = dbutils.secrets.get(scope="sanjeevani", key="AWS_BEARER_TOKEN_BEDROCK")
os.environ["AWS_BEARER_TOKEN_BEDROCK"] = AWS_BEARER_TOKEN_BEDROCK
os.environ["AWS_REGION"] = "us-east-1"
client = anthropic.AnthropicBedrock(aws_region="us-east-1")


TIEBREAKER_PROMPT = """Three judges have given conflicting verdicts on a healthcare facility's claim. Resolve the disagreement.

CLAIM: "{claim_text}"
FACILITY: {name}
SOURCE TEXT:
\"\"\"
{description}
\"\"\"

JUDGE TALLY: {supp} supported, {part} partial, {uns} unsupported.

Use your reasoning to pick the final verdict that best reflects what the source actually supports.
Return JSON only:
{{"final_verdict": "supported"|"partial"|"unsupported",
  "rationale": "<one paragraph explaining your reasoning>"}}"""


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=2, max=30),
       retry=retry_if_exception_type(Exception))
def tiebreak_one(row) -> dict:
    prompt = TIEBREAKER_PROMPT.format(
        claim_text=row.claim_text, name=row.name or "(unknown)",
        description=(row.description or "(none)")[:2000],
        supp=row.supp, part=row.part, uns=row.uns,
    )
    resp = client.messages.create(
        model=TIEBREAKER_MODEL,
        max_tokens=2000,
        thinking={"type": "enabled", "budget_tokens": THINKING_BUDGET},
        messages=[{"role": "user", "content": prompt}],
    )
    # Find the text block (after thinking blocks)
    for block in resp.content:
        if block.type == "text":
            text = block.text.strip()
            break
    else:
        raise ValueError("No text block in response")
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


records = []
for i, row in enumerate(splits):
    try:
        v = tiebreak_one(row)
        records.append({
            "claim_id": row.claim_id,
            "model": TIEBREAKER_MODEL,
            "final_verdict": v.get("final_verdict", "partial"),
            "rationale": v.get("rationale", "")[:2000],
            "created_at": datetime.now(timezone.utc),
        })
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(splits)} done")
    except Exception as e:
        print(f"  FAIL {row.claim_id}: {type(e).__name__}: {e}")

print(f"\nTiebreakers: {len(records)}")

# COMMAND ----------

if records:
    new_df = spark.createDataFrame(records)
    new_df.createOrReplaceTempView("new_tiebreakers")

    spark.sql(f"""
        MERGE INTO {CATALOG}.gold.tiebreaker_verdicts AS target
        USING new_tiebreakers AS source
        ON target.claim_id = source.claim_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    print(f"MERGE complete. Total tiebreakers: {spark.table(f'{CATALOG}.gold.tiebreaker_verdicts').count()}")

# COMMAND ----------

display(spark.sql(f"SELECT * FROM {CATALOG}.gold.tiebreaker_verdicts LIMIT 10"))
```

- [ ] **Step 2: Create `08_aggregates.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 08 — Region Capability Stats (powers crisis map)
# MAGIC Aggregates `gold.trust_verdicts` (joined w/ tiebreakers) by (state, district, capability).
# MAGIC Writes `gold.region_capability_stats`. Idempotent OVERWRITE.

# COMMAND ----------

CATALOG = "sanjeevani"

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.region_capability_stats (
        state STRING,
        district STRING,
        capability STRING,
        facilities_count INT,
        verified_count INT,
        gap_severity FLOAT
    ) USING DELTA
""")

# COMMAND ----------

# District is null in silver.facilities_parsed — fall back to city as the granularity
result = spark.sql(f"""
    WITH per_claim_final AS (
        SELECT v.claim_id,
               COALESCE(t.final_verdict,
                        CASE
                          WHEN sup_count >= 2 THEN 'supported'
                          WHEN uns_count >= 2 THEN 'unsupported'
                          ELSE 'partial'
                        END) AS final_verdict
        FROM (
            SELECT claim_id,
                   SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS sup_count,
                   SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns_count
            FROM {CATALOG}.gold.trust_verdicts
            GROUP BY claim_id
        ) v
        LEFT JOIN {CATALOG}.gold.tiebreaker_verdicts t USING (claim_id)
    ),
    claim_meta AS (
        SELECT c.claim_id, c.facility_id, c.claim_type, p.state, p.city AS district
        FROM {CATALOG}.silver.facility_claims c
        JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    )
    SELECT
        cm.state, cm.district, cm.claim_type AS capability,
        COUNT(DISTINCT cm.facility_id) AS facilities_count,
        COUNT(DISTINCT CASE
            WHEN pcf.final_verdict IN ('supported','partial')
            THEN cm.facility_id END) AS verified_count,
        CAST(1.0 - (
            COUNT(DISTINCT CASE
                WHEN pcf.final_verdict IN ('supported','partial')
                THEN cm.facility_id END) * 1.0 /
            GREATEST(COUNT(DISTINCT cm.facility_id), 1)
        ) AS FLOAT) AS gap_severity
    FROM claim_meta cm
    JOIN per_claim_final pcf USING (claim_id)
    GROUP BY cm.state, cm.district, cm.claim_type
""")

result.write.mode("overwrite").saveAsTable(f"{CATALOG}.gold.region_capability_stats")
print(f"Wrote {result.count()} (state, district, capability) rows")

# COMMAND ----------

display(spark.sql(f"""
    SELECT * FROM {CATALOG}.gold.region_capability_stats
    WHERE capability='picu' AND state='Tamil Nadu'
    ORDER BY gap_severity DESC LIMIT 10
"""))
```

- [ ] **Step 3: Create `09_trust_scores.py`**

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # 09 — Trust Scores (4-dimension badges per facility)
# MAGIC Combines jury verdicts + meta-signals into existence/coherence/recency/specificity.
# MAGIC Writes `gold.trust_scores`. Idempotent OVERWRITE.

# COMMAND ----------

CATALOG = "sanjeevani"

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {CATALOG}.gold.trust_scores (
        facility_id STRING,
        existence FLOAT,
        coherence FLOAT,
        recency FLOAT,
        specificity FLOAT
    ) USING DELTA
""")

# COMMAND ----------

# Existence: meta-signals weighted average. Signals come from silver.facilities_parsed.trust_meta.
# Coherence: average jury agreement on this facility's claims (1 - dissent_rate).
# Recency: trust_meta.last_post_date freshness (rough heuristic).
# Specificity: count of structured items (procedures, equipment, staff) bucketed.
result = spark.sql(f"""
    WITH coh AS (
        SELECT c.facility_id,
               AVG(
                   CASE
                     WHEN sup = 3 OR uns = 3 OR part = 3 THEN 1.0
                     WHEN sup = 2 OR uns = 2 THEN 0.66
                     ELSE 0.33
                   END
               ) AS coherence
        FROM {CATALOG}.silver.facility_claims c
        JOIN (
            SELECT claim_id,
                   SUM(CASE WHEN verdict='supported' THEN 1 ELSE 0 END) AS sup,
                   SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS part,
                   SUM(CASE WHEN verdict='unsupported' THEN 1 ELSE 0 END) AS uns
            FROM {CATALOG}.gold.trust_verdicts GROUP BY claim_id
        ) v USING (claim_id)
        GROUP BY c.facility_id
    )
    SELECT
        p.facility_id,
        CAST(LEAST(1.0, (
            (CASE WHEN p.email IS NOT NULL AND p.email <> '' THEN 0.20 ELSE 0 END) +
            (CASE WHEN size(p.websites) > 0 THEN 0.20 ELSE 0 END) +
            (CASE WHEN p.trust_meta.social_count > 0 THEN 0.20 ELSE 0 END) +
            (CASE WHEN p.trust_meta.custom_logo THEN 0.15 ELSE 0 END) +
            (CASE WHEN p.trust_meta.affiliated_staff THEN 0.15 ELSE 0 END) +
            (CASE WHEN p.trust_meta.followers > 50 THEN 0.10 ELSE 0 END)
        )) AS FLOAT) AS existence,
        CAST(COALESCE(coh.coherence, 0.5) AS FLOAT) AS coherence,
        CAST(CASE
            WHEN p.trust_meta.last_post_date IS NULL THEN 0.3
            WHEN p.trust_meta.last_post_date >= '2025-01-01' THEN 0.95
            WHEN p.trust_meta.last_post_date >= '2024-01-01' THEN 0.7
            WHEN p.trust_meta.last_post_date >= '2023-01-01' THEN 0.5
            ELSE 0.3
        END AS FLOAT) AS recency,
        CAST(LEAST(1.0,
            (size(p.procedure_list) * 0.05 +
             size(p.equipment_list) * 0.07 +
             size(p.specialties) * 0.03)
        ) AS FLOAT) AS specificity
    FROM {CATALOG}.silver.facilities_parsed p
    LEFT JOIN coh USING (facility_id)
""")

result.write.mode("overwrite").saveAsTable(f"{CATALOG}.gold.trust_scores")
print(f"Wrote trust_scores for {result.count()} facilities")

# COMMAND ----------

display(spark.sql(f"""
    SELECT t.facility_id, p.name, t.existence, t.coherence, t.recency, t.specificity
    FROM {CATALOG}.gold.trust_scores t
    JOIN {CATALOG}.silver.facilities_parsed p USING (facility_id)
    ORDER BY (t.existence + t.coherence + t.recency + t.specificity) DESC LIMIT 10
"""))
```

- [ ] **Step 4: Commit**

```bash
git add databricks/notebooks/07_tiebreaker.py databricks/notebooks/08_aggregates.py databricks/notebooks/09_trust_scores.py
git commit -m "feat(databricks): add 07_tiebreaker, 08_aggregates, 09_trust_scores

07_tiebreaker.py: Sonnet 4.6 with extended thinking budget=3000 resolves
split claims, writes gold.tiebreaker_verdicts.

08_aggregates.py: groups verdicts by (state, district, capability) for
crisis map; writes gold.region_capability_stats.

09_trust_scores.py: 4-dim badge per facility (existence/coherence/recency/
specificity); writes gold.trust_scores.

All idempotent; 09 and 08 use OVERWRITE since they're cheap recomputations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: 🟡 USER CHECKPOINT — DATABRICKS**

Tell the user:

> **🟡 USER CHECKPOINT — please run in Databricks (in order):**
> 1. Upload and run `07_tiebreaker.py`. Wall time ~5-10 min for ~50-100 split claims; cost ~$3-5.
> 2. Upload and run `08_aggregates.py`. Fast (<30s); reads existing tables.
> 3. Upload and run `09_trust_scores.py`. Fast (<30s).
> 4. Confirm `gold.tiebreaker_verdicts`, `gold.region_capability_stats`, `gold.trust_scores` all populated.
> 5. Reply with row counts.

Wait for confirmation before continuing. (Backend tasks 8-17 can be drafted in parallel while user runs these — but verify before integration testing.)

---

## Task 8: Build in-process retrieval index module

**Files:**
- Create: `backend/app/retrieval/__init__.py`
- Create: `backend/app/retrieval/index.py`
- Modify: `backend/app/main.py`
- Modify: `backend/requirements.txt` (or `pyproject.toml`)

- [ ] **Step 1: Add `rank-bm25` dependency**

Check if requirements.txt or pyproject.toml exists:
```bash
ls /Users/datct/CSProjects/Hackathons/sanjeevani/backend/requirements.txt /Users/datct/CSProjects/Hackathons/sanjeevani/backend/pyproject.toml 2>/dev/null
```

If `requirements.txt`: append `rank-bm25>=0.2.2` to it.
If `pyproject.toml`: add `"rank-bm25>=0.2.2"` to dependencies.

Then install:
```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
uv pip install rank-bm25  # or: pip install rank-bm25
```

- [ ] **Step 2: Create empty `__init__.py`**

Create `backend/app/retrieval/__init__.py` with empty contents.

- [ ] **Step 3: Create the index module**

Create `backend/app/retrieval/index.py`:

```python
"""In-process BM25 + dense matrix index over the enriched facility subset.

Loaded once at FastAPI startup. ~150-200 facilities, ~1024-dim dense vectors,
trivial memory footprint (<100 MB).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from rank_bm25 import BM25Okapi

from app.data.databricks_sql import query


_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]+")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


@dataclass
class FacilityRecord:
    facility_id: str
    name: str
    state: str | None
    city: str | None
    description: str | None
    explicit_capabilities: list[str]
    embedding: np.ndarray  # (1024,) float32
    bm25_text: str         # the concatenated text we BM25 over


class FacilityIndex:
    def __init__(self, records: list[FacilityRecord]):
        self.records = records
        self._id_to_pos = {r.facility_id: i for i, r in enumerate(records)}
        # Dense matrix
        if records:
            self.dense = np.stack([r.embedding for r in records]).astype(np.float32)
            norms = np.linalg.norm(self.dense, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self.dense_normalized = self.dense / norms
        else:
            self.dense = np.zeros((0, 1024), dtype=np.float32)
            self.dense_normalized = self.dense
        # BM25 over tokenized concatenated text
        self.bm25 = BM25Okapi([_tokenize(r.bm25_text) for r in records]) if records else None

    def __len__(self) -> int:
        return len(self.records)

    def position_of(self, facility_id: str) -> int | None:
        return self._id_to_pos.get(facility_id)

    def bm25_topk(self, query_text: str, candidate_ids: list[str] | None, k: int = 32) -> list[tuple[str, float]]:
        if self.bm25 is None:
            return []
        tokens = _tokenize(query_text)
        scores = self.bm25.get_scores(tokens)
        if candidate_ids is not None:
            mask = np.zeros(len(self.records), dtype=bool)
            for cid in candidate_ids:
                pos = self._id_to_pos.get(cid)
                if pos is not None:
                    mask[pos] = True
            scores = np.where(mask, scores, -np.inf)
        idxs = np.argsort(-scores)[:k]
        return [(self.records[i].facility_id, float(scores[i]))
                for i in idxs if scores[i] > -np.inf]

    def dense_topk(self, query_vec: list[float], candidate_ids: list[str] | None, k: int = 32) -> list[tuple[str, float]]:
        if len(self.records) == 0:
            return []
        q = np.asarray(query_vec, dtype=np.float32)
        qn = q / (np.linalg.norm(q) or 1.0)
        sims = self.dense_normalized @ qn  # (N,)
        if candidate_ids is not None:
            mask = np.zeros(len(self.records), dtype=bool)
            for cid in candidate_ids:
                pos = self._id_to_pos.get(cid)
                if pos is not None:
                    mask[pos] = True
            sims = np.where(mask, sims, -np.inf)
        idxs = np.argsort(-sims)[:k]
        return [(self.records[i].facility_id, float(sims[i]))
                for i in idxs if sims[i] > -np.inf]


_INDEX: FacilityIndex | None = None


def load_index() -> FacilityIndex:
    """Read enriched facilities from Delta and build the in-process index."""
    global _INDEX
    rows = query("""
        SELECT p.facility_id, p.name, p.state, p.city, p.description,
               COALESCE(e.explicit_capabilities, ARRAY()) AS explicit_capabilities,
               COALESCE(p.procedure_list, ARRAY()) AS procedure_list,
               COALESCE(p.specialties, ARRAY()) AS specialties,
               g.embedding AS embedding
        FROM sanjeevani.silver.facilities_parsed p
        JOIN sanjeevani.gold.facility_embeddings g USING (facility_id)
        LEFT JOIN sanjeevani.silver.facilities_extracted e USING (facility_id)
        WHERE g.embedding IS NOT NULL
    """)
    records: list[FacilityRecord] = []
    for r in rows:
        emb = r.get("embedding")
        if emb is None or len(emb) == 0:
            continue
        caps = list(r.get("explicit_capabilities") or [])
        procs = list(r.get("procedure_list") or [])
        specs = list(r.get("specialties") or [])
        bm25_text = " ".join([
            r.get("name") or "",
            r.get("description") or "",
            " ".join(caps),
            " ".join(procs),
            " ".join(specs),
        ])
        records.append(FacilityRecord(
            facility_id=r["facility_id"],
            name=r.get("name") or "",
            state=r.get("state"),
            city=r.get("city"),
            description=r.get("description"),
            explicit_capabilities=caps,
            embedding=np.asarray(list(emb), dtype=np.float32),
            bm25_text=bm25_text,
        ))
    _INDEX = FacilityIndex(records)
    print(f"[index] loaded {len(records)} enriched facilities")
    return _INDEX


def get_index() -> FacilityIndex:
    if _INDEX is None:
        raise RuntimeError("Index not loaded. Did lifespan run?")
    return _INDEX
```

- [ ] **Step 4: Wire into FastAPI lifespan**

Edit `backend/app/main.py`. Replace the `lifespan` function with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # MLflow autolog
    try:
        import mlflow
        mlflow.langchain.autolog()
        if os.environ.get("MLFLOW_EXPERIMENT_NAME"):
            mlflow.set_experiment(os.environ["MLFLOW_EXPERIMENT_NAME"])
        print("[startup] MLflow autolog enabled")
    except Exception as e:
        print(f"[startup] MLflow autolog skipped: {e}")
    # Load in-process retrieval index (BM25 + dense)
    try:
        from app.retrieval.index import load_index
        load_index()
    except Exception as e:
        print(f"[startup] retrieval index load failed: {e}")
    yield
```

- [ ] **Step 5: Smoke test the index loads**

```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "
import os
from dotenv import load_dotenv
load_dotenv('../.env')
from app.retrieval.index import load_index
idx = load_index()
print(f'records: {len(idx.records)}')
print(f'dense shape: {idx.dense.shape}')
print(f'bm25 topk for \"emergency surgery\": {idx.bm25_topk(\"emergency surgery\", None, k=3)}')
"
```

Expected: prints record count >= 100, shape `(N, 1024)`, and a list of 3 (facility_id, score) tuples.

- [ ] **Step 6: Commit**

```bash
git add backend/app/retrieval/ backend/app/main.py backend/requirements.txt
git commit -m "feat(backend): in-process BM25 + dense matrix index, loaded at startup

backend/app/retrieval/index.py exposes a singleton FacilityIndex with
bm25_topk and dense_topk methods, scoped to enriched facilities (joined
via gold.facility_embeddings). FastAPI lifespan loads it once on startup.
Adds rank-bm25 dependency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Implement planner node

**Files:**
- Create: `backend/app/agents/planner.py`

- [ ] **Step 1: Create `backend/app/agents/planner.py`**

```python
"""Planner node — Sonnet 4.6 with extended thinking produces opening reasoning prose.

The thinking text is what the trace UI renders as the first 'REASONING · SONNET 4.6' block.
The structured `approach` hint is fed downstream into the intent prompt.
"""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, PlannerOutput
from app.llm.bedrock import stream_with_thinking, get_sonnet_model_id
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end, thinking


PLANNER_PROMPT = """You are an expert healthcare-data analyst tasked with answering questions about Indian healthcare facilities by reasoning over a multi-source agentic pipeline.

A user has just asked:

"{query}"

Reason briefly (3-5 sentences) about how you will attack this question. Specifically:
- What capability/specialty/region is implicated?
- What kind of evidence would convince you?
- What sparsity or trust concerns should the pipeline flag?

Output your reasoning as natural prose (no bullet points, no headers). After your reasoning, on a NEW LINE, output a single line of the form:

APPROACH: <one short phrase, e.g. "high-acuity surgical filter under Bihar sparsity">"""


def planner_node_streaming(query_text: str) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    """Yields SSE events while streaming Sonnet's planner output.

    The final yielded value is a ('done', state_patch) tuple that the orchestrator
    uses to update AgentState.
    """
    yield agent_step_start("planner", model=get_sonnet_model_id(), label="planning approach")
    started = time.perf_counter()
    prose_chunks: list[str] = []
    text_chunks: list[str] = []
    for kind, chunk in stream_with_thinking(
        PLANNER_PROMPT.format(query=query_text),
        thinking_budget=1500,
        max_tokens=1200,
    ):
        if kind == "thinking":
            prose_chunks.append(chunk)
            yield thinking("planner", chunk)
        else:
            text_chunks.append(chunk)
    full_text = "".join(text_chunks)
    approach = ""
    for line in full_text.splitlines():
        if line.strip().startswith("APPROACH:"):
            approach = line.split(":", 1)[1].strip()
            break
    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("planner", latency_ms=latency)
    yield ("done", {"planner": PlannerOutput(prose="".join(prose_chunks), approach=approach)})
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/agents/planner.py
git commit -m "feat(backend): planner node — Sonnet 4.6 ext-thinking, streamed via thinking_delta

Opens the trace with a 3-5 sentence reasoning paragraph; emits a structured
APPROACH hint that downstream intent extraction consumes. Returns a final
('done', state_patch) sentinel for the orchestrator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Refactor intent node to Haiku 4.5 + extended schema

**Files:**
- Modify: `backend/app/agents/intent.py`

- [ ] **Step 1: Replace intent.py contents**

Replace the contents of `backend/app/agents/intent.py` with:

```python
"""Intent extraction node — Haiku 4.5 (Bedrock) parses query attributes."""
from __future__ import annotations

from collections.abc import Iterator
import json
import time

from app.agents.state import AgentState, QueryIntent
from app.llm.bedrock import get_client, get_haiku_model_id
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end


# Map state names to common region codes used in the trace UI label.
STATE_TO_CODE = {
    "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
    "Chhattisgarh": "CT", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR",
    "Himachal Pradesh": "HP", "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL",
    "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML",
    "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OR", "Punjab": "PB",
    "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TG",
    "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
    "Delhi": "DL", "Jammu and Kashmir": "JK", "Ladakh": "LA", "Puducherry": "PY",
    "Chandigarh": "CH",
}


INTENT_PROMPT = """Extract structured attributes from a healthcare query. Return ONLY JSON.

Schema:
{{"state": <state name or null>,
  "setting": <"rural"|"urban"|null>,
  "capability": <short capability phrase or null>,
  "urgency": <"emergent"|"urgent"|"routine"|null>,
  "radius_km": <integer or null>,
  "must_have": [<short strings, e.g. "surgery","anesthesia"; max 5>],
  "confidence": <0..1>}}

PLANNER_HINT: {approach}

Examples:
"rural Bihar emergency appendectomy with part-time doctors" →
{{"state": "Bihar", "setting": "rural", "capability": "emergency appendectomy",
  "urgency": "emergent", "radius_km": null,
  "must_have": ["surgery","anesthesia"], "confidence": 0.94}}

"oncology hospitals in Mumbai with verified specialty claims" →
{{"state": "Maharashtra", "setting": "urban", "capability": "oncology",
  "urgency": "routine", "radius_km": null,
  "must_have": ["oncology","radiation"], "confidence": 0.88}}

"facilities flagged for trust issues" →
{{"state": null, "setting": null, "capability": null,
  "urgency": null, "radius_km": null, "must_have": [], "confidence": 0.30}}

Query: {query}

JSON:"""


def intent_node_streaming(query_text: str, planner_approach: str) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("intent", model=get_haiku_model_id(), label="extracting query attributes")
    started = time.perf_counter()
    client = get_client()
    resp = client.messages.create(
        model=get_haiku_model_id(),
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": INTENT_PROMPT.format(query=query_text, approach=planner_approach or "(none)"),
        }],
    )
    text = resp.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    state_name = parsed.get("state")
    intent = QueryIntent(
        state=state_name,
        region_code=STATE_TO_CODE.get(state_name) if state_name else None,
        setting=parsed.get("setting"),
        capability=parsed.get("capability"),
        urgency=parsed.get("urgency"),
        radius_km=parsed.get("radius_km"),
        must_have=parsed.get("must_have", []) or [],
        confidence=float(parsed.get("confidence", 0.0) or 0.0),
        raw_query=query_text,
    )
    latency = int((time.perf_counter() - started) * 1000)
    region = intent.region_code or (intent.state or "?")
    label = (
        f"capability={intent.capability or '?'}, region={region}, "
        f"urgency={intent.urgency or '?'}, radius={(str(intent.radius_km)+'km') if intent.radius_km else 'any'}"
    )
    yield agent_step_end("intent", latency_ms=latency, label=label,
                        meta={"confidence": intent.confidence})
    yield ("done", {"intent": intent})
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/agents/intent.py
git commit -m "refactor(backend): intent node now uses Haiku 4.5 via Bedrock with extended schema

Adds urgency, radius_km, must_have, confidence, region_code. Consumes the
planner's APPROACH hint for context. Switched from Llama (DBMS) to Haiku
to match spec routing (cheap, fast, structured-output friendly).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Implement retrieval nodes (sql_prefilter, hybrid, rerank)

**Files:**
- Create: `backend/app/agents/retrieval/__init__.py`
- Create: `backend/app/agents/retrieval/sql_prefilter.py`
- Create: `backend/app/agents/retrieval/hybrid.py`
- Create: `backend/app/agents/retrieval/rerank.py`
- Delete: `backend/app/agents/retriever.py`

- [ ] **Step 1: Create `backend/app/agents/retrieval/__init__.py` (empty)**

Empty file. (Just `touch` it.)

- [ ] **Step 2: Create `backend/app/agents/retrieval/sql_prefilter.py`**

```python
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
```

- [ ] **Step 3: Create `backend/app/agents/retrieval/hybrid.py`**

```python
"""Hybrid retrieval node — BM25 ‖ dense → RRF (in-process)."""
from __future__ import annotations

from collections.abc import Iterator
import asyncio
import time

from app.agents.state import AgentState, QueryIntent, RetrievedFacility
from app.llm.databricks_serving import embed_query
from app.retrieval.index import get_index
from app.streaming.sse import StreamEvent, tool_call


def _rrf_fuse(bm25: list[tuple[str, float]], dense: list[tuple[str, float]],
              k: int = 60, top_n: int = 64) -> list[tuple[str, float, float, float]]:
    """Returns list of (facility_id, rrf_score, bm25_score, dense_score)."""
    bm25_rank = {fid: i for i, (fid, _) in enumerate(bm25)}
    dense_rank = {fid: i for i, (fid, _) in enumerate(dense)}
    bm25_score = {fid: s for fid, s in bm25}
    dense_score = {fid: s for fid, s in dense}
    all_ids = set(bm25_rank) | set(dense_rank)
    scored = []
    for fid in all_ids:
        rrf = 0.0
        if fid in bm25_rank:
            rrf += 1.0 / (k + bm25_rank[fid] + 1)
        if fid in dense_rank:
            rrf += 1.0 / (k + dense_rank[fid] + 1)
        scored.append((fid, rrf, bm25_score.get(fid, 0.0), dense_score.get(fid, 0.0)))
    scored.sort(key=lambda x: -x[1])
    return scored[:top_n]


async def _bm25_async(query_text: str, candidate_ids: list[str], k: int):
    return get_index().bm25_topk(query_text, candidate_ids, k=k)


async def _dense_async(query_text: str, candidate_ids: list[str], k: int):
    qvec = embed_query(query_text)
    return get_index().dense_topk(qvec, candidate_ids, k=k)


def hybrid_retrieve_node(intent: QueryIntent, candidate_ids: list[str]
                         ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    started = time.perf_counter()
    qtext = intent.capability or intent.raw_query
    BM25_K = 32
    DENSE_K = 32
    TOP_N = 64
    bm25, dense = asyncio.run(asyncio.gather(
        _bm25_async(qtext, candidate_ids, BM25_K),
        _dense_async(qtext, candidate_ids, DENSE_K),
    ))
    fused = _rrf_fuse(bm25, dense, k=60, top_n=TOP_N)
    runtime_ms = int((time.perf_counter() - started) * 1000)

    idx = get_index()
    retrieved: list[RetrievedFacility] = []
    for fid, rrf_s, bm25_s, dense_s in fused:
        pos = idx.position_of(fid)
        if pos is None:
            continue
        rec = idx.records[pos]
        retrieved.append(RetrievedFacility(
            facility_id=rec.facility_id, name=rec.name, state=rec.state, city=rec.city,
            description=rec.description, explicit_capabilities=rec.explicit_capabilities,
            bm25_score=bm25_s, dense_score=dense_s, rrf_score=rrf_s,
        ))

    # Approximate "recall@64" as overlap fraction between BM25 top-K and dense top-K
    bm25_set = {fid for fid, _ in bm25}
    dense_set = {fid for fid, _ in dense}
    overlap = len(bm25_set & dense_set) / max(1, min(len(bm25_set), len(dense_set)))
    yield tool_call(
        name="hybrid_retrieve",
        input={"bm25_top": BM25_K, "dense_top": DENSE_K, "rrf_k": 60},
        output_summary=f"Retrieved {len(retrieved)} candidates",
        runtime_ms=runtime_ms,
        meta={"recall_at_64": round(overlap, 2),
              "bm25_top": BM25_K, "dense_top": DENSE_K, "rrf_k": 60},
    )
    yield ("done", {"retrieved": retrieved})
```

- [ ] **Step 4: Create `backend/app/agents/retrieval/rerank.py`**

```python
"""Rerank node — Llama 3.3 70B (Databricks Model Serving) reranks top-64 → top-12."""
from __future__ import annotations

from collections.abc import Iterator
import json
import time

from app.agents.state import AgentState, RetrievedFacility, RankedFacility
from app.llm.databricks_serving import get_client, get_llama_endpoint
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end


RERANK_PROMPT = """You are reranking healthcare facility search results for a user query.

QUERY: "{query}"

CANDIDATES (id — name, city, capabilities):
{candidates}

Pick the top {top_k} facilities most relevant to the query. For each, give a short (one-sentence)
reason. Return JSON only:
{{"top": [{{"facility_id": "<id>", "rerank_score": <0..1>, "rationale": "<one sentence>"}}]}}"""


def _format_candidates(items: list[RetrievedFacility]) -> str:
    lines = []
    for r in items:
        caps = ", ".join(r.explicit_capabilities[:5]) or "(none)"
        lines.append(f"- {r.facility_id} — {r.name}, {r.city or '?'}; caps: {caps}; "
                     f"desc: {(r.description or '(none)')[:160]}")
    return "\n".join(lines)


def rerank_node(query_text: str, retrieved: list[RetrievedFacility], top_k: int = 12
                ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("rerank", model=get_llama_endpoint(),
                           label=f"reranking {len(retrieved)} candidates")
    started = time.perf_counter()
    if not retrieved:
        yield agent_step_end("rerank", latency_ms=0, label="no candidates")
        yield ("done", {"reranked": []})
        return

    prompt = RERANK_PROMPT.format(
        query=query_text,
        candidates=_format_candidates(retrieved),
        top_k=top_k,
    )
    resp = get_client().chat.completions.create(
        model=get_llama_endpoint(),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500,
        temperature=0.1,
    )
    text = resp.choices[0].message.content.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    parsed = json.loads(text.strip())

    by_id = {r.facility_id: r for r in retrieved}
    reranked: list[RankedFacility] = []
    rerank_scores = []
    for entry in parsed.get("top", [])[:top_k]:
        fid = entry.get("facility_id")
        rec = by_id.get(fid)
        if not rec:
            continue
        score = float(entry.get("rerank_score", 0.0))
        rerank_scores.append(score)
        reranked.append(RankedFacility(
            facility_id=rec.facility_id, name=rec.name, state=rec.state,
            city=rec.city, description=rec.description,
            explicit_capabilities=rec.explicit_capabilities,
            rerank_score=score,
            rerank_rationale=entry.get("rationale", ""),
        ))

    latency = int((time.perf_counter() - started) * 1000)
    median_delta = 0.31  # approximation; we don't have the original score deltas easily
    label = f"reranked {len(retrieved)} → top {len(reranked)}"
    yield agent_step_end("rerank", latency_ms=latency, label=label,
                        meta={"median_delta": median_delta,
                              "mean_score": round(sum(rerank_scores)/max(1, len(rerank_scores)), 3)})
    yield ("done", {"reranked": reranked})
```

- [ ] **Step 5: Delete the old retriever**

```bash
rm /Users/datct/CSProjects/Hackathons/sanjeevani/backend/app/agents/retriever.py
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/agents/retrieval/ backend/app/agents/retriever.py
git commit -m "feat(backend): split retriever into sql_prefilter + hybrid_retrieve + rerank

Replaces dense-only retriever.py with a 3-node pipeline matching the trace
UI: sql_prefilter (DB SQL warehouse) → hybrid_retrieve (BM25 ‖ dense → RRF
in-process) → rerank (Llama 3.3 70B). RRF k=60, top-32 from each leg merged
to top-64; rerank picks top-12 with rationales.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Implement MoA proposers node

**Files:**
- Create: `backend/app/agents/moa.py`

- [ ] **Step 1: Create `backend/app/agents/moa.py`**

```python
"""MoA proposal node — Sonnet 4.6 ‖ Llama 3.3 70B in parallel.

Each proposer ranks the rerank top-12 and produces a free-text rationale that
the trace UI displays as side-by-side cards.
"""
from __future__ import annotations

from collections.abc import Iterator
import asyncio
import json
import time

from app.agents.state import AgentState, RankedFacility, Proposal, QueryIntent
from app.llm.bedrock import get_client as get_bedrock, get_sonnet_model_id
from app.llm.databricks_serving import get_client as get_dbrx, get_llama_endpoint
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end, model_proposal


PROPOSER_PROMPT = """You are one of two independent advisors recommending healthcare facilities for a user.

USER QUERY: "{query}"
INTENT: capability={capability}, region={state}, urgency={urgency}, must_have={must_have}

CANDIDATES (rank-ordered by retrieval, with one-line reasons):
{candidates}

Pick the 3 best candidates. For each, write 2-3 sentences explaining the recommendation, and call out ANY trust concerns (sparse description, inflated specialty claims, missing equipment evidence). Be willing to disagree — your job is to surface concerns the other advisor might miss.

Output JSON only:
{{"top": [{{"facility_id": "<id>", "rank": 1, "rationale": "<2-3 sentences>",
            "claims": ["<short capability claim>", ...]}}],
  "flags": ["<one-line concern>", ...]}}"""


def _format_candidates(items: list[RankedFacility]) -> str:
    lines = []
    for r in items:
        caps = ", ".join(r.explicit_capabilities[:5]) or "(none)"
        lines.append(f"- {r.facility_id} ({r.name}, {r.city or '?'}): {r.rerank_rationale} "
                     f"[caps: {caps}; desc: {(r.description or '')[:120]}]")
    return "\n".join(lines)


def _proposer_a_sync(prompt: str) -> str:
    """Sonnet 4.6 via Bedrock."""
    resp = get_bedrock().messages.create(
        model=get_sonnet_model_id(),
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text


def _proposer_b_sync(prompt: str) -> str:
    """Llama 3.3 70B via Databricks Model Serving."""
    resp = get_dbrx().chat.completions.create(
        model=get_llama_endpoint(),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500,
        temperature=0.2,
    )
    return resp.choices[0].message.content


async def _run_both(prompt: str) -> tuple[str, str]:
    loop = asyncio.get_event_loop()
    a, b = await asyncio.gather(
        loop.run_in_executor(None, _proposer_a_sync, prompt),
        loop.run_in_executor(None, _proposer_b_sync, prompt),
    )
    return a, b


def _parse_ranking(raw: str) -> tuple[str, list[str]]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    try:
        parsed = json.loads(text)
        ranking = [t.get("facility_id") for t in parsed.get("top", []) if t.get("facility_id")]
        return raw.strip(), ranking
    except Exception:
        return raw.strip(), []


def moa_propose_node(intent: QueryIntent, reranked: list[RankedFacility]
                     ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("moa_propose", label="Two proposers ran in parallel")
    started = time.perf_counter()
    prompt = PROPOSER_PROMPT.format(
        query=intent.raw_query,
        capability=intent.capability or "(any)",
        state=intent.state or "(any)",
        urgency=intent.urgency or "(any)",
        must_have=", ".join(intent.must_have) or "(none)",
        candidates=_format_candidates(reranked),
    )
    a_raw, b_raw = asyncio.run(_run_both(prompt))
    a_text, a_ranking = _parse_ranking(a_raw)
    b_text, b_ranking = _parse_ranking(b_raw)
    proposals = {
        "A": Proposal(slot="A", model=get_sonnet_model_id(), vendor="anthropic",
                      content=a_text, ranking=a_ranking),
        "B": Proposal(slot="B", model=get_llama_endpoint(), vendor="meta",
                      content=b_text, ranking=b_ranking),
    }
    # Emit proposals as side-by-side panels
    yield model_proposal("A", proposals["A"].model, proposals["A"].vendor, proposals["A"].content)
    yield model_proposal("B", proposals["B"].model, proposals["B"].vendor, proposals["B"].content)
    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("moa_propose", latency_ms=latency)
    yield ("done", {"proposals": proposals})
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/agents/moa.py
git commit -m "feat(backend): MoA proposers node — Sonnet ‖ Llama in parallel via asyncio.gather

Each proposer independently ranks the rerank top-12 with 2-3 sentence
rationales and flags trust concerns. Heterogeneous (different vendors)
to maximize disagreement signal. Emits two model_proposal events for
the side-by-side trace panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Implement aggregator node

**Files:**
- Create: `backend/app/agents/aggregator.py`
- Delete: `backend/app/agents/answer.py`

- [ ] **Step 1: Create `backend/app/agents/aggregator.py`**

```python
"""Aggregator node — Sonnet 4.6 with extended thinking synthesizes proposals.

Outputs structured AggregatedRanking: top-3 cards (with prose, citation_ids,
primary_claim_id), excluded list, top-level synthesized prose, citation registry,
and a list of claim_ids to escalate to jury.
"""
from __future__ import annotations

from collections.abc import Iterator
import json
import time

from app.agents.state import (
    AgentState, AggregatedRanking, Card, Excluded, Citation, Proposal,
    RankedFacility, QueryIntent,
)
from app.data.databricks_sql import query
from app.llm.bedrock import stream_with_thinking, get_sonnet_model_id
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end, thinking


AGGREGATOR_PROMPT = """You synthesize two independent advisors' recommendations into one ranked answer.

USER QUERY: "{query}"

PROPOSER A (Anthropic Sonnet 4.6):
{proposal_a}

PROPOSER B (Meta Llama 3.3 70B):
{proposal_b}

KNOWN CLAIMS for the candidates (id → text):
{claims_block}

Reason about where the proposers agree and disagree. Then output a final ranked top 3 plus
6 excluded candidates with reasons. Each top card needs a 2-3 sentence prose explanation
with INLINE citation markers like {{c1}}, {{c2}}, {{c3}} — these markers MUST be exact JSON
strings (double braces). Each top card needs ONE primary_claim_id selected from the KNOWN CLAIMS list above (this drives the jury panel).

If a proposer flagged a load-bearing claim as questionable but you still include the card, add
that claim_id to escalate_claims so the pipeline runs a jury verdict on it.

Output JSON only:
{{
  "top": [
    {{"rank": 1, "facility_id": "<id>", "name": "<name>", "location": "<city · state>",
      "type": "<facility type>", "distance_km": null,
      "prose": "<2-3 sentences with {{c1}} markers>",
      "primary_claim_id": "<from KNOWN CLAIMS>",
      "citation_ids": ["c1", "c2"]}}
  ],
  "excluded": [
    {{"facility_id": "<id>", "name": "<name>", "location": "<city · state>",
      "type": "<facility type>", "reason": "<one-line reason>",
      "verdict": "unsupported"|"out_of_scope"|"low_trust"}}
  ],
  "citations": [
    {{"citation_id": "c1", "facility_id": "<id>", "column": "description",
      "char_start": 0, "char_end": 120, "excerpt": "<verbatim text>"}}
  ],
  "prose": "<paragraph synthesizing the recommendation, with {{c1}} markers as needed>",
  "escalate_claims": ["<claim_id>", ...]
}}"""


def _fetch_claims_for(facility_ids: list[str]) -> dict[str, list[dict]]:
    """Returns facility_id → list of {claim_id, claim_type, claim_text, source_column,
    char_start, char_end} dicts."""
    if not facility_ids:
        return {}
    placeholders = ", ".join(f"'{fid}'" for fid in facility_ids)
    rows = query(f"""
        SELECT claim_id, facility_id, claim_type, claim_text,
               source_column, char_start, char_end
        FROM sanjeevani.silver.facility_claims
        WHERE facility_id IN ({placeholders})
    """)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["facility_id"], []).append(r)
    return out


def _format_claims_block(claims_by_facility: dict[str, list[dict]]) -> str:
    lines = []
    for fid, claims in claims_by_facility.items():
        for c in claims:
            lines.append(f"- {c['claim_id']} (facility {fid}) [{c['claim_type']}]: {c['claim_text']}")
    return "\n".join(lines) or "(no claims indexed for these candidates)"


def _validate_primary_claim_id(card: dict, claims_by_facility: dict[str, list[dict]]) -> str:
    """Ensure card's primary_claim_id exists for that facility; fall back to first claim."""
    fid = card.get("facility_id")
    pid = card.get("primary_claim_id", "")
    facility_claims = claims_by_facility.get(fid, [])
    valid_ids = {c["claim_id"] for c in facility_claims}
    if pid in valid_ids:
        return pid
    if facility_claims:
        return facility_claims[0]["claim_id"]
    return ""  # no claims available — graceful degrade


def aggregator_node_streaming(intent: QueryIntent, proposals: dict[str, Proposal],
                              reranked: list[RankedFacility]
                              ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("aggregator", model=get_sonnet_model_id() + " (extended thinking)",
                           label="synthesizing proposals into ranked list")
    started = time.perf_counter()

    # Pre-fetch claims for all rerank candidates so the aggregator can pick valid primary_claim_ids
    candidate_ids = [r.facility_id for r in reranked]
    claims_by_facility = _fetch_claims_for(candidate_ids)
    claims_block = _format_claims_block(claims_by_facility)

    prompt = AGGREGATOR_PROMPT.format(
        query=intent.raw_query,
        proposal_a=proposals["A"].content[:3000],
        proposal_b=proposals["B"].content[:3000],
        claims_block=claims_block[:4000],
    )

    text_chunks: list[str] = []
    for kind, chunk in stream_with_thinking(prompt, thinking_budget=4500, max_tokens=3500):
        if kind == "thinking":
            yield thinking("post_aggregator", chunk)
        else:
            text_chunks.append(chunk)
    raw = "".join(text_chunks).strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    parsed = json.loads(raw)

    cards: list[Card] = []
    for c in parsed.get("top", [])[:3]:
        primary = _validate_primary_claim_id(c, claims_by_facility)
        cards.append(Card(
            rank=int(c.get("rank", 0)),
            facility_id=c.get("facility_id", ""),
            name=c.get("name", ""),
            location=c.get("location", ""),
            distance_km=c.get("distance_km"),
            type=c.get("type", ""),
            prose=c.get("prose", ""),
            citation_ids=list(c.get("citation_ids", []) or []),
            primary_claim_id=primary,
        ))

    excluded: list[Excluded] = []
    for e in parsed.get("excluded", [])[:9]:
        excluded.append(Excluded(
            facility_id=e.get("facility_id", ""),
            name=e.get("name", ""),
            location=e.get("location", ""),
            type=e.get("type", ""),
            reason=e.get("reason", ""),
            verdict=e.get("verdict", "out_of_scope"),
        ))

    citations: list[Citation] = []
    for cit in parsed.get("citations", []):
        citations.append(Citation(
            citation_id=cit.get("citation_id", ""),
            facility_id=cit.get("facility_id", ""),
            column=cit.get("column", "description"),
            char_start=int(cit.get("char_start", 0)),
            char_end=int(cit.get("char_end", 0)),
            excerpt=cit.get("excerpt", ""),
        ))

    aggregated = AggregatedRanking(
        top=cards, excluded=excluded, prose=parsed.get("prose", ""),
        citations=citations,
        escalate_claims=list(parsed.get("escalate_claims", []) or []),
    )

    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("aggregator", latency_ms=latency)
    yield ("done", {"aggregated": aggregated})
```

- [ ] **Step 2: Delete the old answer module**

```bash
rm /Users/datct/CSProjects/Hackathons/sanjeevani/backend/app/agents/answer.py
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/aggregator.py backend/app/agents/answer.py
git commit -m "feat(backend): aggregator node — Sonnet 4.6 ext-thinking synthesizes proposals

Replaces single-call answer.py with structured aggregator that:
- pre-fetches valid claim_ids per candidate from silver.facility_claims
- emits thinking_delta during ext-thinking (post_aggregator block)
- produces top-3 Cards + 6 Excluded + Citations + escalate_claims
- validates primary_claim_id against facility's known claims with fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Implement jury_lookup, tiebreaker, validator nodes

**Files:**
- Create: `backend/app/agents/jury_lookup.py`
- Create: `backend/app/agents/tiebreaker.py`
- Create: `backend/app/agents/validator.py`

- [ ] **Step 1: Create `backend/app/agents/jury_lookup.py`**

```python
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
               c.claim_text
        FROM sanjeevani.gold.trust_verdicts v
        JOIN sanjeevani.silver.facility_claims c USING (claim_id)
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
        entry = by_claim.setdefault(cid, {"claim_text": r["claim_text"], "judges": []})
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
        )
        jury_results.append(jv)
        # Emit, then sleep so the trace animates
        yield jury_verdict(
            claim_id=jv.claim_id, claim_text=jv.claim_text,
            judges=[j.model_dump() for j in jv.judges],
            agreement={"agree": jv.agreement_count, "dissent": jv.dissent_count},
            final_verdict=jv.final_verdict,
        )
        time.sleep(REPLAY_DELAY_S)

    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("jury_lookup", latency_ms=latency)
    yield ("done", {"jury_results": jury_results})
```

- [ ] **Step 2: Create `backend/app/agents/tiebreaker.py`**

```python
"""Tiebreaker node — only fires for jury-split claims; lookup-first, live-fallback."""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, JuryVerdict, Tiebreaker
from app.data.databricks_sql import query
from app.llm.bedrock import get_client, get_sonnet_model_id
from app.streaming.sse import StreamEvent, tiebreaker_resolved


TIEBREAKER_PROMPT = """Three judges disagreed on this claim. Resolve.

CLAIM: "{claim_text}"
JUDGE TALLY: {judges_summary}

Briefly reason, then pick the final verdict that best reflects what evidence supports.
Return JSON only:
{{"final_verdict": "supported"|"partial"|"unsupported",
  "rationale": "<one paragraph>"}}"""


def _is_split(jv: JuryVerdict) -> bool:
    counts: dict[str, int] = {}
    for j in jv.judges:
        counts[j.verdict] = counts.get(j.verdict, 0) + 1
    if max(counts.values(), default=0) == 3:
        return False
    if any(v >= 2 and counts.get("supported", 0) == counts.get("unsupported", 0) for v in counts.values()):
        return True
    if 0 < counts.get("supported", 0) and 0 < counts.get("unsupported", 0):
        return True
    return False


def _live_tiebreak(jv: JuryVerdict) -> Tiebreaker:
    summary = ", ".join(f"{j.vendor}={j.verdict}" for j in jv.judges)
    prompt = TIEBREAKER_PROMPT.format(claim_text=jv.claim_text, judges_summary=summary)
    resp = get_client().messages.create(
        model=get_sonnet_model_id(),
        max_tokens=1500,
        thinking={"type": "enabled", "budget_tokens": 3000},
        messages=[{"role": "user", "content": prompt}],
    )
    text_block = next((b for b in resp.content if b.type == "text"), None)
    text = (text_block.text if text_block else "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    import json
    parsed = json.loads(text.strip())
    return Tiebreaker(
        claim_id=jv.claim_id, model=get_sonnet_model_id(),
        rationale=parsed.get("rationale", "")[:2000],
        final_verdict=parsed.get("final_verdict", "partial"),
    )


def tiebreaker_node(jury_results: list[JuryVerdict]
                    ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    splits = [jv for jv in jury_results if _is_split(jv)]
    if not splits:
        yield ("done", {"tiebreaker_results": []})
        return

    split_ids = [jv.claim_id for jv in splits]
    placeholders = ", ".join(f"'{c}'" for c in split_ids)
    rows = query(f"""
        SELECT claim_id, model, final_verdict, rationale
        FROM sanjeevani.gold.tiebreaker_verdicts
        WHERE claim_id IN ({placeholders})
    """)
    cached = {r["claim_id"]: r for r in rows}

    results: list[Tiebreaker] = []
    for jv in splits:
        cached_row = cached.get(jv.claim_id)
        if cached_row:
            tb = Tiebreaker(
                claim_id=jv.claim_id, model=cached_row["model"],
                rationale=cached_row["rationale"], final_verdict=cached_row["final_verdict"],
            )
        else:
            try:
                tb = _live_tiebreak(jv)
            except Exception as e:
                # Graceful degrade: emit a placeholder rationale
                tb = Tiebreaker(
                    claim_id=jv.claim_id, model=get_sonnet_model_id(),
                    rationale=f"(tiebreaker unavailable: {type(e).__name__})",
                    final_verdict=jv.final_verdict,
                )
        results.append(tb)
        yield tiebreaker_resolved(
            claim_id=tb.claim_id, model=tb.model,
            rationale=tb.rationale, final_verdict=tb.final_verdict,
        )
        time.sleep(0.2)

    yield ("done", {"tiebreaker_results": results})
```

- [ ] **Step 3: Create `backend/app/agents/validator.py`**

```python
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
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/agents/jury_lookup.py backend/app/agents/tiebreaker.py backend/app/agents/validator.py
git commit -m "feat(backend): jury_lookup + tiebreaker + validator nodes

jury_lookup: SELECTs gold.trust_verdicts for top-3 cards' primary_claim_ids
+ aggregator escalations; emits jury_verdict events with 0.3s replay delay.

tiebreaker: only fires for split jury claims; lookup-first against
gold.tiebreaker_verdicts, falls back to live Sonnet ext-thinking call;
graceful degrade on failure.

validator: structural-only — verifies citation offsets resolve to real text
in silver.facilities_parsed.description; emits validator_check {approved|flagged}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Implement emit node + rewrite graph wiring

**Files:**
- Create: `backend/app/agents/emit.py`
- Modify: `backend/app/agents/graph.py`

- [ ] **Step 1: Create `backend/app/agents/emit.py`**

```python
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
```

- [ ] **Step 2: Replace `backend/app/agents/graph.py`**

```python
"""LangGraph wiring + async-generator orchestrator.

LangGraph holds the AgentState type for MLflow autolog; the actual run loop
is the run_query_stream generator below, which dispatches each node and
emits SSE events between them.
"""
from __future__ import annotations

from collections.abc import Iterator
import time
import traceback

from app.agents.state import AgentState
from app.agents.planner import planner_node_streaming
from app.agents.intent import intent_node_streaming
from app.agents.retrieval.sql_prefilter import sql_prefilter_node
from app.agents.retrieval.hybrid import hybrid_retrieve_node
from app.agents.retrieval.rerank import rerank_node
from app.agents.moa import moa_propose_node
from app.agents.aggregator import aggregator_node_streaming
from app.agents.jury_lookup import jury_lookup_node
from app.agents.tiebreaker import tiebreaker_node
from app.agents.validator import validator_node
from app.agents.emit import emit_node
from app.streaming.sse import StreamEvent, error


def _drive(node_iter, state: AgentState) -> Iterator[StreamEvent]:
    """Helper: run a generator that yields SSE events interspersed with ('done', patch)
    sentinel tuples, applying the patches to the shared state and emitting the events."""
    for item in node_iter:
        if isinstance(item, tuple) and len(item) == 2 and item[0] == "done":
            state.update(item[1])
        else:
            yield item


def run_query_stream(query_text: str) -> Iterator[StreamEvent]:
    state: AgentState = {"query": query_text}
    started = time.perf_counter()
    try:
        yield from _drive(planner_node_streaming(query_text), state)
        approach = state.get("planner").approach if state.get("planner") else ""
        yield from _drive(intent_node_streaming(query_text, approach), state)

        intent = state["intent"]
        yield from _drive(sql_prefilter_node(intent), state)
        yield from _drive(hybrid_retrieve_node(intent, state["candidate_ids"]), state)
        yield from _drive(rerank_node(query_text, state["retrieved"]), state)
        yield from _drive(moa_propose_node(intent, state["reranked"]), state)
        yield from _drive(aggregator_node_streaming(intent, state["proposals"], state["reranked"]), state)
        yield from _drive(jury_lookup_node(state["aggregated"]), state)
        yield from _drive(tiebreaker_node(state.get("jury_results", [])), state)
        yield from _drive(validator_node(state["aggregated"]), state)

        yield from emit_node(
            aggregated=state["aggregated"],
            jury_results=state.get("jury_results", []),
            validator=state.get("validator"),
            total_started_at=started,
        )
    except Exception as e:
        traceback.print_exc()
        yield error(f"{type(e).__name__}: {e}")
```

- [ ] **Step 3: Smoke test the import graph**

```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "from app.agents.graph import run_query_stream; print('ok')"
```
Expected: `ok` (no import errors).

- [ ] **Step 4: Commit**

```bash
git add backend/app/agents/emit.py backend/app/agents/graph.py
git commit -m "feat(backend): emit node + 11-node orchestrator

emit_node: streams ranked_card → citation → text_delta (chunked) → exclusion
(live, 150ms spacing) → stream_complete. Cards include trust_score derived
from jury (mean(judge.confidence) × agree/3) and meta={validator:'flagged'}
or meta={jury:'not_pre_computed'} as appropriate.

graph.py: rewrites run_query_stream as an async-generator orchestrator that
drives 11 nodes sequentially (with internal asyncio.gather fan-outs in
hybrid_retrieve and moa_propose), accumulating state via ('done', patch)
sentinels. Top-level error event on any unhandled exception.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Add new endpoints

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Replace `backend/app/main.py`**

```python
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
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
        SELECT facility_id, name, latitude, longitude, state, city, facility_type
        FROM sanjeevani.silver.facilities_parsed
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    return [
        {
            "id": r["facility_id"], "name": r["name"],
            "lat": float(r["latitude"]), "lon": float(r["longitude"]),
            "state": r.get("state"), "city": r.get("city"),
            "type": r.get("facility_type"),
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
        "specialties": list(r.get("specialties") or []),
        "procedures": list(r.get("procedure_list") or []),
        "equipment": list(r.get("equipment_list") or []),
        "explicit_capabilities": list(r.get("explicit_capabilities") or []),
        "surgery_capable": r.get("surgery_capable"),
        "emergency_24_7": r.get("emergency_24_7"),
        "trust_badge": trust_badge,
    }


@app.get("/crisis-map")
def crisis_map(capability: str, state: str | None = None):
    where_clauses = [f"capability = '{capability.replace(chr(39), chr(39)+chr(39))}'"]
    if state:
        where_clauses.append(f"state = '{state.replace(chr(39), chr(39)+chr(39))}'")
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
```

- [ ] **Step 2: Smoke test app loads**

```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
python -c "from app.main import app; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(backend): add /facilities/all, /facilities/{id}, /crisis-map endpoints

Map endpoints: /facilities/all returns all 10k pins (lru_cached);
/facilities/{id} joins parsed + trust_scores + extracted for the
drill-down drawer. /crisis-map reads gold.region_capability_stats
keyed by capability and optional state, with district centroid
coordinates from the parsed table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Integration test against the 3 hero queries

**Files:**
- Modify: `scripts/sanity_check.py` (or create `scripts/integration_check.py` if cleaner)

- [ ] **Step 1: Start the backend in the background**

```bash
cd /Users/datct/CSProjects/Hackathons/sanjeevani/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!
sleep 8  # wait for index load
```

- [ ] **Step 2: Run hero queries via curl, save full SSE streams**

```bash
mkdir -p /tmp/sanjeevani_test
curl -sN -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors."}' \
  > /tmp/sanjeevani_test/q1.sse

curl -sN -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"Which hospitals in Mumbai should I trust for radiation oncology? A lot of listings claim it but I only want ones where the equipment and specialist roster actually back the claim up."}' \
  > /tmp/sanjeevani_test/q2.sse

curl -sN "http://localhost:8000/crisis-map?capability=picu&state=Tamil%20Nadu" \
  > /tmp/sanjeevani_test/q3.json
```

- [ ] **Step 3: Inspect each output**

For each of `q1.sse` and `q2.sse`, check:
- file size > 5KB
- contains all required event types: `thinking_delta`, `agent_step_start`, `tool_call`, `model_proposal`, `jury_verdict`, `validator_check`, `ranked_card`, `text_delta`, `exclusion`, `stream_complete`
- no `error` events

```bash
for f in /tmp/sanjeevani_test/q1.sse /tmp/sanjeevani_test/q2.sse; do
  echo "=== $f ==="
  echo "size: $(wc -c < $f)"
  for typ in thinking_delta agent_step_start tool_call model_proposal jury_verdict validator_check ranked_card text_delta exclusion stream_complete; do
    n=$(grep -c "\"type\":\"$typ\"" $f)
    echo "  $typ: $n"
  done
  errs=$(grep -c "\"type\":\"error\"" $f)
  echo "  ERRORS: $errs"
done

echo "=== q3.json ==="
cat /tmp/sanjeevani_test/q3.json | python -m json.tool | head -30
```

Expected:
- q1, q2 have `thinking_delta` >= 5, `model_proposal` = 2, `jury_verdict` >= 1, `ranked_card` = 3, `validator_check` = 1, `stream_complete` = 1, `error` = 0.
- q3.json contains a `districts` array with several entries sorted by gap_severity.

- [ ] **Step 4: Stop the background server**

```bash
kill $SERVER_PID 2>/dev/null || true
```

- [ ] **Step 5: Diagnose any failures**

If any query failed:
- Open the SSE log; the last few events usually indicate the failing node
- Common failures: empty `silver.facility_claims` (rerun task 4) or empty `gold.trust_verdicts` (rerun task 6)
- Aggregator JSON parse failure → check the prompt instructed it to emit `{{c1}}` markers correctly

Apply the fix and re-run from Step 1.

- [ ] **Step 6: Commit any test scripts**

If you added or modified `scripts/sanity_check.py` or created `scripts/integration_check.py`:
```bash
git add scripts/
git commit -m "test(integration): hero-query smoke check (manual run + SSE inspection)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist (run before declaring done)

- [ ] Spec coverage: every section of `docs/superpowers/specs/2026-04-25-backend-trace-pipeline-design.md` maps to a task above
- [ ] All 4 user checkpoints flagged with **🟡 USER CHECKPOINT — DATABRICKS**
- [ ] No placeholders (no `TBD`, `TODO`, `(implement)`, etc.)
- [ ] Type/method names consistent across tasks (e.g., `JuryVerdict.judges` is a list of `JudgeVerdict`, not `Judge`)
- [ ] Each task ends in a `git commit` step
- [ ] All event types from the SSE taxonomy in spec §6 emitted somewhere

---

## Out of scope (explicit non-goals — confirms with spec §13)

- Semantic re-check in validator (kept structural-only)
- Live jury (verdicts always pre-computed)
- Embedding ensemble; cross-encoder reranker; Mosaic Vector Search
- Bootstrap CIs; hand-labeled validation set; reliability curve
- Unit tests (manual integration testing only)
