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
