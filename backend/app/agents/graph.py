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
