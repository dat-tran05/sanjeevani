"""Tiebreaker node — only fires for jury-split claims; lookup-first, live-fallback."""
from __future__ import annotations

from collections.abc import Iterator
import json
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
    # max_tokens MUST exceed thinking_budget (Anthropic requirement)
    resp = get_client().messages.create(
        model=get_sonnet_model_id(),
        max_tokens=4500,
        thinking={"type": "enabled", "budget_tokens": 3000},
        messages=[{"role": "user", "content": prompt}],
    )
    text_block = next((b for b in resp.content if b.type == "text"), None)
    text = (text_block.text if text_block else "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
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
