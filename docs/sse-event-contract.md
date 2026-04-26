# SSE Event Contract — Sanjeevani

> **Audience:** the backend partner extending `backend/app/streaming/sse.py`.
> **Source of truth on the frontend:** `frontend/lib/sse.ts` (discriminated union).
> **Demo fallback for missing events:** `frontend/lib/demo/trace.ts` (typed StreamEvent[]).

The Explorer's `useEventStream` hook (`frontend/lib/hooks/use-event-stream.ts`) merges live SSE events with baked demo events so the frontend can ship before all backend nodes exist. The moment your backend emits a wire-shape-matching event, the corresponding demo fallback stops triggering — no frontend changes needed.

---

## Wire format

```
data: {"type":"<event_type>","data":{...}}\n\n
```

One event per SSE frame. Frames separated by `\n\n`. Unrecognized fields are tolerated (`as unknown as StreamEvent`); missing required fields will fail at runtime when the frontend tries to access them.

---

## Existing events (already wired in `app/streaming/sse.py`)

These work end-to-end today; just keep emitting them with the fields below. The frontend renders them in the Explorer trace stream.

### `thinking_delta`
Claude extended-thinking text. Streams as deltas so the typewriter effect runs.

```json
{"type":"thinking_delta","data":{"text":"The user is asking about emergency appendectomy access in rural Bihar..."}}
```

### `agent_step_start` / `agent_step_end`
**Important: `step_id` is now required to pair start with end.** The frontend uses it to flip a single timeline node from spinner to checkmark when the matching end arrives.

```json
{"type":"agent_step_start","data":{"step_id":"intent","name":"intent","label":"Intent extraction · Haiku 4.5"}}
{"type":"agent_step_end","data":{"step_id":"intent","name":"intent","summary":"Parsed intent: capability=emergency_surgery, region=Bihar, urgency=emergent","detail":"{\"state\":\"Bihar\",\"capability\":\"appendectomy\"}","duration_ms":412}}
```

| Field | Type | Notes |
|---|---|---|
| `step_id` | string | Stable id, e.g. `intent`, `retriever`, `aggregate`. |
| `name` | string | Internal node name (free-form). |
| `label` | string | Human-readable label, e.g. `Intent extraction · Haiku 4.5`. |
| `summary` | string? | Result line shown under the label on end. |
| `detail` | string? | Mono-text body (SQL snippet, JSON, breakdown) — multi-line allowed. Renders in a code block under the summary. |
| `duration_ms` | number? | Renders as `· 412ms` next to label. |

### `tool_call`
Renders as a mono-typeset node with optional `tool_out` block.

```json
{"type":"tool_call","data":{"tool":"sql_prefilter","input":{"query":"..."},"output_summary":"→ 429 facilities matched\n→ runtime: 218ms","duration_ms":218}}
```

### `text_delta`
Final answer tokens. Frontend currently doesn't render these in the trace panel — they go to the Explorer's main answer column when wired.

```json
{"type":"text_delta","data":{"text":"Sri Krishna Hospital "}}
```

### `citation`
Inline citation pill; click opens FacilityDrawer scrolled to char range.

```json
{"type":"citation","data":{"citation_id":"c1","facility_id":"F-MZN-0214","column":"description","char_start":124,"char_end":216,"excerpt":"24-hour emergency theatre with on-call general surgery"}}
```

### `error`
Surfaced as a crimson validator stamp.

```json
{"type":"error","data":{"message":"upstream timeout"}}
```

---

## NEW events the partner needs to emit

These are currently stubbed via `frontend/lib/demo/trace.ts`. Match the JSON shape exactly and the demo fallback stops triggering.

### `model_proposal` — MoA proposers
Emit one event per proposer. The frontend groups consecutive `model_proposal` events into a single side-by-side card. `proposer_id: "A"` lands on the left, `"B"` on the right.

```json
{"type":"model_proposal","data":{
  "proposer_id":"A",
  "vendor":"Anthropic · Sonnet 4.6",
  "title":"Two proposers ran in parallel",
  "text":"Recommends Sri Krishna (3/3 verified), Darbhanga (2/3 partial), Vaishali (escalate)."
}}
{"type":"model_proposal","data":{
  "proposer_id":"B",
  "vendor":"Meta · Llama 3.3 70B",
  "title":"Two proposers ran in parallel",
  "text":"Recommends Sri Krishna and Darbhanga, but flags Vaishali — equipment list not specific enough."
}}
```

| Field | Type |
|---|---|
| `proposer_id` | `"A"` \| `"B"` |
| `vendor` | string — provider + model |
| `title` | string — section header |
| `text` | string — proposer's reasoning |

Backend reference: `docs/OVERVIEW.md` §5.3 stage 6 (MoA Proposer A / B).

### `consensus_resolved` — three-judge jury
The signature wow shot. Emit once per claim verdicted.

```json
{"type":"consensus_resolved","data":{
  "claim":"claim_id: cap_es_F-MZN-0214",
  "title":"Sri Krishna runs 24/7 emergency surgery",
  "verdict":"supported",
  "agreement":3,
  "dissent":false,
  "judges":[
    {"name":"Claude Sonnet 4.6","vendor":"Anthropic · Bedrock","verdict":"supported","confidence":0.94,"excerpt":"operates a 24-hour emergency theatre..."},
    {"name":"Llama 3.3 70B","vendor":"Meta · Databricks","verdict":"supported","confidence":0.88,"excerpt":"lists laparoscopic appendectomy..."},
    {"name":"Qwen 3 80B","vendor":"Databricks · DBRX","verdict":"supported","confidence":0.91,"excerpt":"six-bed surgical ICU"}
  ]
}}
```

If all three judges initially disagreed, include a `tiebreaker`:

```json
"tiebreaker": {
  "model": "Sonnet 4.6 · extended thinking",
  "verdict": "partial",
  "reasoning": "All three judges identify a real signal but disagree on its strength. ..."
}
```

When a judge dissents from the consensus, set `dissent_note`:

```json
{"name":"Llama 3.3 70B", ..., "dissent_note":"Description is general. 'Operation theatre' alone doesn't establish 24-hour surgical capability."}
```

| Field | Type |
|---|---|
| `claim` | string — the claim being verdicted |
| `title` | string? — display title |
| `verdict` | `"supported"` \| `"partial"` \| `"unsupported"` |
| `agreement` | `0` \| `1` \| `2` \| `3` — judges agreeing with consensus |
| `dissent` | bool — true if any judge dissented |
| `judges` | array of `{name, vendor, verdict, confidence, excerpt, dissent_note?}` |
| `tiebreaker` | optional `{model, verdict, reasoning}` |

Backend reference: `docs/OVERVIEW.md` §5.3 stage 7 (Mixture of Agents aggregator + jury reasoning) and §6 (4-dim trust scorer).

### `validator_pass` — post-MoA validator
The final stamp. Emit once after the validator agent runs.

```json
{"type":"validator_pass","data":{
  "title":"Validator · Sonnet 4.6 (fresh context)",
  "body":"All citation offsets verified against silver.facilities.description text. No hallucinated references. Output approved.",
  "passed":true
}}
```

`passed:false` flips the node to crimson.

Backend reference: `docs/OVERVIEW.md` stretch goal #1 (Self-Correction Loops / Validator Agent).

### `recommendations_ready` — terminal payload
Drives the RecommendationCard list and WhyNotThese panel. Emit once at the end of the stream.

```json
{"type":"recommendations_ready","data":{
  "facilities":[ /* RecommendedFacility[] — see below */ ],
  "excluded":[ /* ExcludedFacility[] — see below */ ],
  "pipeline_ms":8400,
  "candidates_considered":12
}}
```

#### `RecommendedFacility`
```ts
{
  id: string;                    // "F-MZN-0214"
  name: string;
  type: string;                  // "Government Hospital"
  state: string;                 // "Bihar"
  district: string;              // "Muzaffarpur"
  latitude: number;
  longitude: number;
  distance_km: number;
  trust: {
    existence: 0 | 1 | 2 | 3;
    coherence: 0 | 1 | 2 | 3;
    recency: 0 | 1 | 2 | 3;
    specificity: 0 | 1 | 2 | 3;
    score: number;               // 0–1 aggregate
  };
  capabilities: Array<{
    name: string;                // "Emergency Surgery"
    agree: "3/3" | "2/3" | "1/3" | "0/3";
    verdict: "supported" | "partial" | "unsupported";
  }>;
  citations: Array<{
    id: string;                  // "c1"
    column: "description" | "capability" | string;
    char_start: number;
    char_end: number;
    text: string;                // exact span
  }>;
  description: string;           // full free-text; citations index char offsets here
}
```

#### `ExcludedFacility`
```ts
{
  name: string;
  district: string;
  type: string;
  reason: string;                // "Listed orthopedics specialty but no surgery procedure cited"
  verdict: "partial" | "unsupported";
}
```

Backend reference: `docs/OVERVIEW.md` §5.3 (terminal output) and §7.4 (Why Not These).

---

## Demo-fallback behavior (you don't need to do anything for this)

Until the backend emits one of `model_proposal` / `consensus_resolved` / `validator_pass` / `recommendations_ready`, the frontend synthesizes the missing events from `lib/demo/trace.ts` after the live stream ends. In dev mode each demo-sourced event renders with a small gold "demo" pill so it's obvious which parts of the contract are still stubbed.

When you ship a new event type, it just lights up live in the trace stream — no frontend code change needed.

---

## REST endpoints (also stubbed, also handoff)

Atlas data is currently bundled at `lib/demo/{states-geo, districts-geo, capability-bias}.ts`. Swappable to live REST by changing one import per file. The endpoint shapes the frontend would consume:

```
GET  /api/states              → { states: StateGeo[] }
GET  /api/districts           → { districts: DistrictPoint[] }
GET  /api/state-stats?cap=:c  → { gaps: Record<string, number> }   // 0–1 per state id, per capability
```

`StateGeo` and `DistrictPoint` are exported from `frontend/lib/types.ts`. The demo data was hand-traced; for production these should come from `gold.region_capability_stats` joined with a real GeoJSON source.

---

## Reference: the wire-shape decisions made for you

These came up while writing the frontend; calling them out so they don't surface as surprises later:

1. **`agent_step_start`/`agent_step_end` are paired by `step_id`.** Without `step_id`, the frontend can't reliably pair them when multiple steps run concurrently. Old contract had only `name`; new contract requires stable `step_id`.

2. **`citation` carries `citation_id`, not just char offsets.** The drawer's spotlight (`<mark className="spotlight">`) keys on `citation_id` matching the URL `?citation=…` param. Char offsets alone aren't a stable id when the description is updated.

3. **`recommendations_ready` is the terminal structured payload.** It includes both winning facilities and excluded ones — the frontend renders both from a single event rather than expecting separate `recommendation` and `exclusion` events.

4. **`model_proposal` is per-proposer, not batched.** The design's mock data batched both proposers into one payload; we split them so the frontend can show "Proposer A is in" before B arrives. Frontend groups them visually.

5. **`consensus_resolved.agreement` is an integer 0..3, not a percent.** The 3-segment animated agreement bar keys directly off this count.
