"""Run with: cd backend && pytest -v"""
import json
from app.streaming.sse import (
    StreamEvent, EventType, thinking, agent_step_start, text, citation,
)


def test_to_sse_format():
    ev = StreamEvent(type=EventType.TEXT_DELTA, data={"text": "hi"})
    out = ev.to_sse()
    assert out.endswith("\n\n")
    assert out.startswith("data: ")
    payload = json.loads(out[6:].strip())
    assert payload == {"type": "text_delta", "data": {"text": "hi"}}


def test_thinking_helper():
    ev = thinking("Considering Bihar facilities...")
    assert ev.type == EventType.THINKING_DELTA
    assert ev.data == {"text": "Considering Bihar facilities..."}


def test_agent_step_helper():
    ev = agent_step_start("retriever", "looking up Bihar candidates")
    assert ev.type == EventType.AGENT_STEP_START
    assert ev.data["name"] == "retriever"


def test_text_helper():
    ev = text("Apollo Hospital")
    assert ev.type == EventType.TEXT_DELTA
    assert ev.data == {"text": "Apollo Hospital"}


def test_citation_helper():
    ev = citation("fac-123", "description", 12, 50, "performs surgery 24/7")
    assert ev.type == EventType.CITATION
    assert ev.data["facility_id"] == "fac-123"
    assert ev.data["char_start"] == 12
    assert ev.data["char_end"] == 50
