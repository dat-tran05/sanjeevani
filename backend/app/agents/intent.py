"""Intent extraction node — parses query attributes (state, setting, capability)."""
import json
from app.agents.state import AgentState, QueryIntent
from app.llm.databricks_serving import get_client, get_llama_endpoint

INTENT_PROMPT = """Extract query attributes from a user's healthcare query. Return ONLY JSON.

Schema:
{{"state": <state name or null>, "setting": <"rural"|"urban"|null>, "capability": <short capability phrase or null>}}

Examples:
"rural Bihar emergency appendectomy" → {{"state": "Bihar", "setting": "rural", "capability": "emergency appendectomy"}}
"oncology hospitals in Mumbai" → {{"state": "Maharashtra", "setting": "urban", "capability": "oncology"}}
"facilities flagged for trust issues" → {{"state": null, "setting": null, "capability": null}}

Query: {query}

JSON:"""


def intent_node(state: AgentState) -> AgentState:
    query = state["query"]
    resp = get_client().chat.completions.create(
        model=get_llama_endpoint(),
        messages=[{"role": "user", "content": INTENT_PROMPT.format(query=query)}],
        max_tokens=200,
        temperature=0.0,
    )
    text = resp.choices[0].message.content.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    parsed = json.loads(text)
    intent = QueryIntent(
        state=parsed.get("state"),
        setting=parsed.get("setting"),
        capability=parsed.get("capability"),
        raw_query=query,
    )
    return {**state, "intent": intent}
