"""LangGraph wiring — intent → retriever → answer (streaming via callback)."""
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
        yield agent_step_start("intent", "extracting query attributes")
        graph = build_graph()
        result = graph.invoke({"query": query_text})
        intent = result["intent"]
        yield agent_step_end("intent", f"state={intent.state} setting={intent.setting} capability={intent.capability}")

        yield agent_step_start("retriever", "querying facilities")
        yield tool_call("databricks_sql", {"state": intent.state}, output_summary=f"{len(result.get('candidates', []))} candidates")
        yield agent_step_end("retriever", f"{len(result.get('candidates', []))} candidates ranked")

        yield agent_step_start("answer", "synthesizing answer with Sonnet 4.6")
        for chunk in answer_node_streaming(result):
            yield text(chunk)
        yield agent_step_end("answer")

        # Emit citations for top 3 candidates
        for f in result.get("candidates", [])[:3]:
            if f.description:
                excerpt = f.description[:200]
                yield citation(f.facility_id, "description", 0, len(excerpt), excerpt)
    except Exception as e:
        yield error(f"{type(e).__name__}: {e}")
