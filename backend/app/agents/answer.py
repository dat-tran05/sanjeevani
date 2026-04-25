"""Answer node — Sonnet 4.6 reads top candidates, produces cited response."""
from collections.abc import Iterator
from app.agents.state import AgentState
from app.llm.bedrock import get_client, get_sonnet_model_id


ANSWER_PROMPT = """You are a healthcare advisor for India. A user has asked:

"{query}"

You have these candidate facilities (ranked by relevance):

{facilities}

Pick the top 3 most relevant. For each, give:
- Facility name and city
- Why it fits the query (cite specific text from its description or capabilities)
- Any caveats (missing info, partial fit)

Be concise — about 2-3 sentences per facility. If none fit well, say so."""


def format_facilities(candidates) -> str:
    parts = []
    for i, f in enumerate(candidates, 1):
        caps = ", ".join(f.explicit_capabilities[:5]) if f.explicit_capabilities else "(none)"
        parts.append(
            f"{i}. {f.name} — {f.city or '?'}, {f.state or '?'}\n"
            f"   Description: {(f.description or '(none)')[:300]}\n"
            f"   Capabilities: {caps}\n"
            f"   Similarity: {f.similarity:.3f}"
        )
    return "\n\n".join(parts) if parts else "(no candidates found)"


def answer_node_streaming(state: AgentState) -> Iterator[str]:
    """Yields text chunks (no SSE wrapping — caller wraps)."""
    candidates = state.get("candidates", [])
    prompt = ANSWER_PROMPT.format(
        query=state["query"],
        facilities=format_facilities(candidates),
    )
    client = get_client()
    with client.messages.stream(
        model=get_sonnet_model_id(),
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for delta in stream.text_stream:
            yield delta
