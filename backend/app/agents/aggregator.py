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
    # max_tokens MUST exceed thinking_budget (Anthropic requirement)
    for kind, chunk in stream_with_thinking(prompt, thinking_budget=4500, max_tokens=6500):
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
