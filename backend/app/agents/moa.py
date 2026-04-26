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


def _summarize_proposer(raw: str, name_by_id: dict[str, str]) -> str:
    """Turn a proposer's raw JSON output into a short trace-friendly summary
    using facility NAMES instead of hash IDs. Falls back to truncated raw
    text on parse failure.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    try:
        parsed = json.loads(text)
        top = parsed.get("top") or []
        if not top:
            raise ValueError("empty top")
        bits = []
        for t in top[:3]:
            fid = t.get("facility_id", "")
            rank = t.get("rank", "?")
            nm = name_by_id.get(fid) or (fid[:8] + "…" if fid else "(unknown)")
            bits.append(f"{nm} (rank {rank})")
        flags = parsed.get("flags") or []
        flag = (flags[0] if flags else (top[0].get("rationale") or ""))[:240]
        flag = flag.rstrip(".") + "." if flag else ""
        return f"Recommends {', '.join(bits)}." + (f" {flag}" if flag else "")
    except Exception:
        flat = " ".join(raw.split())
        return flat[:280] + ("…" if len(flat) > 280 else "")


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
    # Emit proposals as side-by-side panels — use a NAME-based short summary
    # for the trace UI (the full raw JSON is preserved in `proposals` for the
    # aggregator to consume downstream).
    name_by_id = {r.facility_id: r.name for r in reranked}
    a_short = _summarize_proposer(a_text, name_by_id)
    b_short = _summarize_proposer(b_text, name_by_id)
    yield model_proposal("A", proposals["A"].model, proposals["A"].vendor, a_short)
    yield model_proposal("B", proposals["B"].model, proposals["B"].vendor, b_short)
    latency = int((time.perf_counter() - started) * 1000)
    yield agent_step_end("moa_propose", latency_ms=latency)
    yield ("done", {"proposals": proposals})
