"""Intent extraction node — Haiku 4.5 (Bedrock) parses query attributes."""
from __future__ import annotations

from collections.abc import Iterator
import json
import time

from app.agents.state import AgentState, QueryIntent
from app.llm.bedrock import get_client, get_haiku_model_id
from app.streaming.sse import StreamEvent, agent_step_start, agent_step_end


# Map state names to common region codes used in the trace UI label.
STATE_TO_CODE = {
    "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
    "Chhattisgarh": "CT", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR",
    "Himachal Pradesh": "HP", "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL",
    "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML",
    "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OR", "Punjab": "PB",
    "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TG",
    "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
    "Delhi": "DL", "Jammu and Kashmir": "JK", "Ladakh": "LA", "Puducherry": "PY",
    "Chandigarh": "CH",
}


INTENT_PROMPT = """Extract structured attributes from a healthcare query. Return ONLY JSON.

Schema:
{{"state": <state name or null>,
  "setting": <"rural"|"urban"|null>,
  "capability": <short capability phrase or null>,
  "urgency": <"emergent"|"urgent"|"routine"|null>,
  "radius_km": <integer or null>,
  "must_have": [<short strings, e.g. "surgery","anesthesia"; max 5>],
  "confidence": <0..1>}}

PLANNER_HINT: {approach}

Examples:
"rural Bihar emergency appendectomy with part-time doctors" →
{{"state": "Bihar", "setting": "rural", "capability": "emergency appendectomy",
  "urgency": "emergent", "radius_km": null,
  "must_have": ["surgery","anesthesia"], "confidence": 0.94}}

"oncology hospitals in Mumbai with verified specialty claims" →
{{"state": "Maharashtra", "setting": "urban", "capability": "oncology",
  "urgency": "routine", "radius_km": null,
  "must_have": ["oncology","radiation"], "confidence": 0.88}}

"facilities flagged for trust issues" →
{{"state": null, "setting": null, "capability": null,
  "urgency": null, "radius_km": null, "must_have": [], "confidence": 0.30}}

Query: {query}

JSON:"""


def intent_node_streaming(query_text: str, planner_approach: str) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    yield agent_step_start("intent", model=get_haiku_model_id(), label="extracting query attributes")
    started = time.perf_counter()
    client = get_client()
    resp = client.messages.create(
        model=get_haiku_model_id(),
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": INTENT_PROMPT.format(query=query_text, approach=planner_approach or "(none)"),
        }],
    )
    text = resp.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    state_name = parsed.get("state")
    intent = QueryIntent(
        state=state_name,
        region_code=STATE_TO_CODE.get(state_name) if state_name else None,
        setting=parsed.get("setting"),
        capability=parsed.get("capability"),
        urgency=parsed.get("urgency"),
        radius_km=parsed.get("radius_km"),
        must_have=parsed.get("must_have", []) or [],
        confidence=float(parsed.get("confidence", 0.0) or 0.0),
        raw_query=query_text,
    )
    latency = int((time.perf_counter() - started) * 1000)
    region = intent.region_code or (intent.state or "?")
    label = (
        f"capability={intent.capability or '?'}, region={region}, "
        f"urgency={intent.urgency or '?'}, radius={(str(intent.radius_km)+'km') if intent.radius_km else 'any'}"
    )
    yield agent_step_end("intent", latency_ms=latency, label=label,
                        meta={"confidence": intent.confidence})
    yield ("done", {"intent": intent})
