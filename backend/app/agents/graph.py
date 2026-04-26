"""LangGraph wiring — intent → retriever → answer (streaming via callback)."""
import time
from collections.abc import Iterator

from langgraph.graph import StateGraph, START, END

from app.agents.state import AgentState
from app.agents.intent import intent_node
from app.agents.retriever import retriever_node
from app.agents.answer import answer_node_streaming
from app.streaming.sse import (
    StreamEvent, agent_step_start, agent_step_end, tool_call, text, citation, error,
)


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("intent", intent_node)
    graph.add_node("retriever", retriever_node)
    graph.add_edge(START, "intent")
    graph.add_edge("intent", "retriever")
    graph.add_edge("retriever", END)  # answer is streamed outside the graph
    return graph.compile()


def run_query_stream(query_text: str) -> Iterator[StreamEvent]:
    """Top-level: runs the graph, streams events, finishes with answer streaming."""
    try:
        # intent
        t0 = time.perf_counter()
        yield agent_step_start("intent", "intent", "Intent extraction · Llama 3.3")
        graph = build_graph()
        result = graph.invoke({"query": query_text})
        intent = result["intent"]
        intent_detail = (
            f'{{"state":"{intent.state}",'
            f'"setting":"{intent.setting}",'
            f'"capability":"{intent.capability}"}}'
        )
        yield agent_step_end(
            "intent",
            "intent",
            summary=f"state={intent.state} setting={intent.setting} capability={intent.capability}",
            detail=intent_detail,
            duration_ms=(time.perf_counter() - t0) * 1000,
        )

        # retriever
        t1 = time.perf_counter()
        yield agent_step_start("retriever", "retriever", "Hybrid retrieval · Databricks SQL + GTE")
        n_candidates = len(result.get("candidates", []))
        retriever_detail = (
            "SELECT * FROM silver.facilities_extracted\n"
            f" WHERE state='{intent.state}'\n"
            "   AND facility_type IN ('hospital','clinic')\n"
            f"→ {n_candidates} candidates"
        )
        yield tool_call(
            "databricks_sql",
            input={"state": intent.state},
            output_summary=f"{n_candidates} candidates",
            duration_ms=(time.perf_counter() - t1) * 1000,
        )
        yield agent_step_end(
            "retriever",
            "retriever",
            summary=f"{n_candidates} candidates ranked",
            detail=retriever_detail,
            duration_ms=(time.perf_counter() - t1) * 1000,
        )

        # answer
        t2 = time.perf_counter()
        yield agent_step_start("answer", "answer", "Synthesis · Sonnet 4.6")
        for chunk in answer_node_streaming(result):
            yield text(chunk)
        yield agent_step_end(
            "answer",
            "answer",
            detail=f"Synthesized response from top {min(n_candidates, 3)} candidates with citations.",
            duration_ms=(time.perf_counter() - t2) * 1000,
        )

        # Emit citations for top 3 candidates with stable ids c1, c2, c3
        for i, f in enumerate(result.get("candidates", [])[:3], start=1):
            if f.description:
                excerpt = f.description[:200]
                yield citation(
                    f"c{i}",
                    f.facility_id,
                    "description",
                    0,
                    len(excerpt),
                    excerpt,
                )
    except Exception as e:
        yield error(f"{type(e).__name__}: {e}")
