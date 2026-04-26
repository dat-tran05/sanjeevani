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
    # max_tokens MUST exceed thinking_budget (Anthropic requirement)
    for kind, chunk in stream_with_thinking(
        PLANNER_PROMPT.format(query=query_text),
        thinking_budget=1500,
        max_tokens=3000,
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
