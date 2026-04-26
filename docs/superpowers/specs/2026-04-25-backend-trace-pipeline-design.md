# Backend Trace Pipeline — Design Spec

> Phase B2 of Sanjeevani. Builds the full agent-trace backend that powers the chat + trace UI shown in the demo mockups. Extends the Phase A1+B1 thin-slice end-to-end stream into the 11-node Verifiable Consensus pipeline (planner → intent → retrieval → MoA → jury → tiebreaker → validator → emit).

---

## 1. Context

### What we have (Phase A1+B1 thin-slice)

- LangGraph: `intent → retriever → answer` (3 nodes)
- Retriever is dense-only NumPy cosine (no BM25, no rerank)
- Single Sonnet 4.6 call for the answer (no MoA, no jury, no validator)
- 100 Bihar rows enriched (extracted + embedded)
- 5 SSE events live (`agent_step_start/end`, `tool_call`, `text_delta`, `citation`); 3 declared-but-unused (`thinking_delta`, `model_proposal`, `consensus_resolved`)
- End-to-end working: curl produces a streamed answer with citations

### What the trace UI requires

The demo mockup shows a 12-step agent trace and a chat panel with structured ranked cards, numbered citation chips, and a "Why not these?" exclusion list. The pipeline must:

1. Open with a free-text **REASONING** block (Sonnet planning prose)
2. Extract structured intent (Haiku 4.5, with confidence and latency)
3. Run a **SQL prefilter** with row count + runtime + index info
4. Run **hybrid retrieval** (BM25 ‖ dense → RRF) with recall metric
5. **Rerank** top-64 → top-12 with Llama 3.3
6. Fan out to **two MoA proposers** (Sonnet 4.6 ‖ Llama 3.3) in parallel
7. **Aggregate** with Sonnet ext-thinking, surfacing the second REASONING block
8. **Look up jury verdicts** (3 judges per claim) with replayed timing
9. **Tiebreaker** for split claims (Sonnet ext-thinking)
10. **Validator** (independent fresh-context Sonnet, structural offset check)
11. Emit ranked cards, prose answer, and exclusion list to the chat panel

### Constraints

- 24-hour build window; partner is on frontend
- Demo on 3 hero queries; "bare minimum for the rest"
- Must run on Databricks Free Edition (rate-limit aware)
- Anthropic models via AWS Bedrock only

---

## 2. Hero queries

These drive enrichment subset selection. Every other facility in the 10k dataset is map-visible only.

1. **"Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors."**
   Muscle: rural sparsity + surgical capability + soft staffing constraint. Already covered by 100 Bihar rows.

2. **"Which hospitals in Mumbai should I trust for radiation oncology? A lot of listings claim it, but I only want ones where the equipment and specialist roster actually back the claim up."**
   Muscle: verification under inflated specialty claims. Triggers MoA disagreement and jury PARTIAL/UNSUPPORTED panels naturally.

3. **"Where are the pediatric ICU deserts across Tamil Nadu? Show me districts where the nearest verified PICU is more than 100 km from a major population center."**
   Muscle: aggregate / crisis-map query. *Not* served via the chat-trace pipeline — served via a separate `/crisis-map` endpoint with the choropleth as the affordance. Click a district → drawer.

---

## 3. Pipeline topology (11 nodes)

```
[1]  planner          Sonnet 4.6 + ext-thinking (budget 1500)
                      Reads raw query, emits planning prose + structured "approach" hint.
                      SSE: agent_step_start → thinking_delta * many → agent_step_end

[2]  intent           Haiku 4.5 (Bedrock)
                      Inputs: query + planner.approach
                      Outputs: QueryIntent {state, region_code, capability, urgency,
                               setting, radius_km, must_have[], confidence}
                      SSE: agent_step_start/end with latency + label

[3]  sql_prefilter    databricks-sql-connector
                      SQL filter on silver.facilities_parsed (state, geo bbox, type)
                      → candidate_ids (~50-150)
                      SSE: tool_call(sql_prefilter, runtime_ms, matched_count, index)

[4]  hybrid_retrieve  in-process; BM25 (rank-bm25) ‖ dense (NumPy cosine)  ⭐ parallel
                      Both restricted to candidate_ids from [3]
                      RRF (k=60) merges top-32 from each → top-64
                      SSE: tool_call(hybrid_retrieve, sub-summary, recall_at_64)

[5]  rerank           Llama 3.3 70B (Databricks Model Serving)
                      One LLM call: "Rank these 64 by fit to query Q, top 12"
                      SSE: agent_step_start/end with latency + median Δ-score

[6]  moa_propose      ⭐ parallel: Sonnet 4.6 ‖ Llama 3.3 70B
                      Each gets top-12 + intent, returns RankedProposal
                      {top: [{facility_id, rank, rationale, claims[]}], flags[]}
                      SSE: model_proposal × 2 (slot=A,B), then agent_step_end

[7]  aggregator       Sonnet 4.6 + ext-thinking (budget 4500)
                      Inputs: proposal_A, proposal_B
                      Outputs: AggregatedRanking {final_top: [Card×3], excluded: [Excluded×9],
                               prose: str, citations: [Citation×N], escalate_claims[]}
                      Each card carries primary_claim_id (validated against candidate set;
                      falls back to first claim in silver.facility_claims if invalid)
                      SSE: thinking_delta * many (post_aggregator block) → agent_step_end

[8]  jury_lookup      databricks-sql-connector
                      For each top-3 card.primary_claim_id (+ aggregator's escalate_claims)
                      SELECT FROM gold.trust_verdicts.
                      Replay each verdict with 200-400ms artificial delay.
                      SSE: agent_step_start → tool_call(lookup_jury_verdicts) →
                           jury_verdict × N → agent_step_end

[9]  tiebreaker       For each split claim from [8]: lookup gold.tiebreaker_verdicts.
                      Cache miss → live-call Sonnet 4.6 ext-thinking (~3s).
                      SSE: tiebreaker_resolved × N (only fires when [8] surfaced splits)

[10] validator        Sonnet 4.6 (fresh context, no prior messages)
                      Structural-only: confirm each citation's char_start/char_end resolves
                      to real text in silver.facilities_parsed.description.
                      No semantic re-ranking; that's deferred.
                      SSE: agent_step_start → validator_check {status} → agent_step_end

[11] emit             Local Python — no LLM
                      Order: ranked_card × 3 → citation × N → text_delta * many
                             → exclusion × ~6 (live, with 150ms spacing) → stream_complete
                      Cards + citations + prose all come from aggregator state buffered
                      since [7]; emit gates them on validator approval.
```

**Sequential except [4] and [6], which fan out via `asyncio.gather` inside the node.** Total wall time: 8-14s per query.

### Cost & latency per query

| Node | Model | ~Latency | ~Cost |
|---|---|---|---|
| planner | Sonnet 4.6 ext-thinking | 1.8s | $0.03 |
| intent | Haiku 4.5 | 0.4s | <$0.01 |
| sql_prefilter | DBSQL | 0.2s | — |
| hybrid_retrieve | local | <0.1s | — |
| rerank | Llama 3.3 (DBMS) | 2.7s | (free quota) |
| moa_propose | Sonnet ‖ Llama | 4.0s | $0.05 |
| aggregator | Sonnet 4.6 ext-thinking | 4.5s | $0.07 |
| jury_lookup | DBSQL + replay | 1.1s | — |
| tiebreaker | cache hit / fallback | 0-3s | $0-0.04 |
| validator | Sonnet 4.6 | 1.3s | $0.02 |
| emit | local | 1-2s | — |
| **Total** | | **~12s** | **~$0.20** |

---

## 4. State shape

```python
class AgentState(TypedDict, total=False):
    query: str
    planner: PlannerOutput          # {prose, approach}
    intent: QueryIntent             # state, region_code, capability, urgency,
                                    # setting, radius_km, must_have[], confidence
    candidate_ids: list[str]        # after sql_prefilter
    retrieved: list[RetrievedFacility]   # after hybrid_retrieve+RRF, top-64
    reranked: list[RankedFacility]  # after rerank, top-12
    proposals: dict[str, Proposal]  # {"A": ..., "B": ...}
    aggregated: AggregatedRanking   # {top, excluded, prose, citations, escalate_claims}
    jury_results: list[JuryVerdict]
    tiebreaker_results: list[Tiebreaker]
    validator: ValidatorResult      # {status, message, broken_offsets: []}
    timings: dict[str, int]         # node_name → ms
```

All models are pydantic. Defined in `backend/app/agents/state.py`.

---

## 5. Delta tables (offline pipeline output)

### Existing (no schema changes)

- `bronze.facilities_raw` (10k)
- `silver.facilities_parsed` (10k)
- `silver.facilities_extracted` (extend subset; existing schema)
- `gold.facility_embeddings` (extend subset; existing schema)

### New: `silver.facility_claims`

One row per extractable assertion. The unit the jury verdicts on.

```
claim_id          STRING  (e.g., "cap_es_F-MZN-0214" — facility_id + claim_type slot)
facility_id       STRING
claim_type        STRING  ("emergency_surgery" | "oncology_specialty" | "picu" | ...)
claim_text        STRING  ("Sri Krishna runs 24/7 emergency surgery")
source_column     STRING  ("description")
char_start, char_end  INT
created_at        TIMESTAMP
PRIMARY KEY: claim_id
```

### New: `gold.trust_verdicts`

Three rows per claim — one per judge. Aggregation (`agreement_rate`, `consensus_verdict`) computed at lookup time.

```
claim_id          STRING
judge_model       STRING  ("us.anthropic.claude-sonnet-4-6" |
                           "databricks-meta-llama-3-3-70b-instruct" |
                           "databricks-qwen3-next-80b-a3b-instruct")
judge_vendor      STRING  ("anthropic" | "meta" | "databricks")
verdict           STRING  ("supported" | "partial" | "unsupported")
confidence        FLOAT   (0..1)
quote             STRING  (source-text excerpt judge cited)
created_at        TIMESTAMP
PRIMARY KEY: (claim_id, judge_model)
```

### New: `gold.tiebreaker_verdicts`

Only populated for jury-split claims.

```
claim_id          STRING  PRIMARY KEY
model             STRING  ("us.anthropic.claude-sonnet-4-6")
final_verdict     STRING
rationale         STRING  (extended-thinking summary)
created_at        TIMESTAMP
```

### New: `gold.region_capability_stats`

Powers the crisis map (query 3) and `/crisis-map` endpoint.

```
state             STRING
district          STRING
capability        STRING  (claim_type)
facilities_count  INT     (denominator: all facilities in district claiming it)
verified_count    INT     (numerator: claims where final_verdict IN ('supported','partial'))
gap_severity      FLOAT   (1 - verified_count / max(1, facilities_count); higher = worse)
```

### New: `gold.trust_scores`

4-dimension trust badge per facility. Drives the trust drill-down UI (separate from the per-card trust_score in `ranked_card`).

```
facility_id       STRING  PRIMARY KEY
existence         FLOAT   (0..1; meta-signals: phone, email, website, recency, social)
coherence         FLOAT   (0..1; rule-based contradictions + LLM cross-check)
recency           FLOAT   (0..1; recency_of_page_update + last_post_date)
specificity       FLOAT   (0..1; count of structured items)
```

---

## 6. SSE event taxonomy (final)

| Event | Payload sketch |
|---|---|
| `thinking_delta` | `{step_id: "planner"\|"post_aggregator", text: str}` |
| `agent_step_start` | `{name, model?, label?}` |
| `agent_step_end` | `{name, latency_ms, label?, meta?}` |
| `tool_call` | `{name, input, output_summary, runtime_ms, meta?}` |
| `model_proposal` | `{slot: "A"\|"B", model, vendor, content}` |
| `jury_verdict` | `{claim_id, claim_text, judges: [{model, vendor, verdict, confidence, quote}], agreement: {agree, dissent}, final_verdict}` |
| `tiebreaker_resolved` | `{claim_id, model, rationale, final_verdict}` |
| `validator_check` | `{model, status: "approved"\|"flagged", message, broken_offsets?: []}` |
| `ranked_card` | `{rank, facility_id, name, location, distance_km, type, trust_score, prose, citation_ids, primary_claim_id, meta?}` |
| `citation` | `{citation_id: "c1", facility_id, column, char_start, char_end, excerpt}` |
| `text_delta` | `{text}` |
| `exclusion` | `{facility_id, name, location, type, reason, verdict}` |
| `stream_complete` | `{recommendation_count, exclusion_count, total_latency_ms}` |
| `error` | `{message, stage?}` |

### Wire ordering (canonical)

```
trace events (planner → intent → sql → retrieve → rerank → MoA → aggregator → jury → tiebreaker → validator)
   ↓ validator approves
ranked_card × 3 → citation × N → text_delta * many → exclusion × ~6 → stream_complete
```

Cards + citations + prose are buffered in state from [7] aggregator and only emitted after [10] validator approves. If validator flags, cards still emit but with `meta: {validator: "flagged"}` and broken citation chips greyed out — never block the user.

### Implicit contracts

- **Cards before citations.** Cards' `citation_ids` reference citations that arrive next; frontend buffers per-card.
- **`{{c1}}` markers in prose.** `text_delta` content contains literal `{{c1}}` tokens which the frontend replaces with chips that link to `citation` events by `citation_id`. Aggregator prompt enforces this format.
- **Trust score per card.** Computed as `mean(judge.confidence) × (agree_count / 3)` over the card's `primary_claim_id` jury verdicts. Per OVERVIEW spec, this is *not* the 4-dimension trust badge — that lives in `gold.trust_scores` and surfaces in the click-to-drill UI.

---

## 7. In-process retrieval index

Built at FastAPI startup (`lifespan` hook). Scoped to enriched subset (~150 facilities).

- Read `gold.facility_embeddings` JOIN `silver.facilities_extracted` JOIN `silver.facilities_parsed` JOIN `silver.facility_claims`
- Hold dense vectors as a single `(N, 1024)` NumPy array
- Build BM25 index over concatenation of `name + description + explicit_capabilities + procedure_list + capability_list`
- Indices keyed by row position; `facility_id` lookup table on the side
- Module: `backend/app/retrieval/index.py`, exports a `get_index()` singleton

Wall time at startup: ~10-20s. Memory footprint: <100MB.

---

## 8. Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | existing |
| `/query` | POST | extended for new pipeline |
| `/facilities/all` | GET | NEW. Returns 10k pins (id, name, lat, lon, state, type) for the map. Static, cached in memory. ~1MB JSON. |
| `/facilities/{id}` | GET | NEW. Full detail; if facility is in enriched subset, includes 4-dim trust badge. |
| `/crisis-map` | GET | NEW. Query params: `capability` (required), `state` (optional). Returns `{districts: [{id, name, verified_count, facilities_count, gap_severity, lat, lon, ...}]}`. Powers query 3. |

CORS unchanged.

---

## 9. Offline pipeline (extends existing notebooks; adds 4 new)

### Reduction strategies (all adopted)

- **R1 — Narrower enrichment subset.** Pre-filter `02_extract.py` to ~150 facilities matching candidate patterns for the 3 hero queries (regex over description + state filter).
- **R2 — Lazy jury.** After R1, dry-run each of the 3 hero queries through retrieval+rerank+aggregator to capture top-12 candidates' load-bearing claim_ids. `06_jury.py` only verdicts those (~80-150 claims).
- **R3 — Skip query 3 from chat-trace pipeline.** PICU desert is map-only via `/crisis-map`. No MoA/jury/validator path needed for it.

Cost falls from ~$25-40 to ~$5-10. Wall time from ~30-45 min to ~10 min.

### Notebooks

| Notebook | Status | Output |
|---|---|---|
| `00_setup_uc.py` | existing | UC catalog + schemas |
| `01_bronze_silver.py` | existing | bronze.facilities_raw + silver.facilities_parsed |
| `02_extract.py` | **extend** | + `silver.facility_claims` (one row per surfaced capability with stable claim_id and source offsets); broaden subset filter to ~150 facilities across 3 hero queries |
| `05_embeddings.py` | rerun | gold.facility_embeddings (idempotent MERGE picks up new rows) |
| `06_jury.py` | **NEW** | gold.trust_verdicts (3 judges × ~80-150 claims; tenacity retry + throttle) |
| `07_tiebreaker.py` | **NEW** | gold.tiebreaker_verdicts (only split claims) |
| `08_aggregates.py` | **NEW** | gold.region_capability_stats |
| `09_trust_scores.py` | **NEW** | gold.trust_scores |

### `02_extract.py` subset filter

```sql
WHERE (state='Bihar' AND description RLIKE '(?i)(surgery|emergency|operation|theatre)')
   OR (state='Maharashtra' AND city IN ('Mumbai','Thane','Navi Mumbai')
       AND (description RLIKE '(?i)(oncolog|cancer|radiation|chemo)' OR specialties LIKE '%oncology%'))
   OR (state='Tamil Nadu' AND description RLIKE '(?i)(pediatric|paediatric|PICU|NICU|intensive care)')
LIMIT 150
```

### Run order

```
02_extract.py (extended)  →  silver.facility_claims  +  silver.facilities_extracted
05_embeddings.py          →  gold.facility_embeddings
[dry-run hero queries to capture load-bearing claim_ids]
06_jury.py                →  gold.trust_verdicts
07_tiebreaker.py          →  gold.tiebreaker_verdicts
08_aggregates.py          →  gold.region_capability_stats
09_trust_scores.py        →  gold.trust_scores
```

All idempotent (Delta MERGE on PK).

---

## 10. Error handling / graceful degradation

| Failure | Response |
|---|---|
| `jury_lookup` returns empty for a card's `primary_claim_id` (off-script variant) | Skip `jury_verdict` + `tiebreaker` events for that card. `ranked_card.meta = {jury: "not_pre_computed"}`; frontend shows muted "Verdict pending" badge. |
| Aggregator returns invalid `primary_claim_id` (hallucinated) | Validate against candidate's known claim_ids; fall back to first claim from `silver.facility_claims` for that facility. Log warning. |
| Bedrock or Databricks Model Serving 429/timeout | Tenacity retry (max 8s); if exhausted, emit `error` event with stage name and abort the stream cleanly. |
| Validator flags broken citation offsets | Emit `validator_check {status: "flagged", broken_offsets: [...]}`; surface cards anyway with broken chips greyed out. |
| Tiebreaker cache miss for split claim | Live-call Sonnet 4.6 ext-thinking inline (~3s). Cache result for next time (write to `gold.tiebreaker_verdicts`). |

---

## 11. File change manifest

### Modified

- `backend/app/agents/state.py` — extend AgentState; add PlannerOutput, RankedFacility, Proposal, AggregatedRanking, JuryVerdict, Tiebreaker, ValidatorResult, Card, Excluded, Citation, Claim
- `backend/app/agents/intent.py` — extend QueryIntent (urgency, radius_km, must_have, confidence); switch from Llama to Haiku 4.5 via Bedrock
- `backend/app/agents/retriever.py` — split into `agents/retrieval/{sql_prefilter,hybrid,rerank}.py`
- `backend/app/agents/answer.py` → renamed `agents/aggregator.py`; structured aggregator output (cards + prose + escalations + primary_claim_ids)
- `backend/app/agents/graph.py` — full rewrite around 11-node pipeline + new event ordering
- `backend/app/streaming/sse.py` — add new event constructors
- `backend/app/llm/bedrock.py` — add Haiku 4.5 client + `stream_with_thinking` helper
- `backend/app/main.py` — new endpoints; lifespan loads in-process retrieval indexes
- `backend/app/data/databricks_sql.py` — typed query helpers for new gold tables

### Created

- `backend/app/agents/planner.py`
- `backend/app/agents/retrieval/__init__.py`, `sql_prefilter.py`, `hybrid.py`, `rerank.py`
- `backend/app/agents/moa.py`
- `backend/app/agents/jury_lookup.py`
- `backend/app/agents/tiebreaker.py`
- `backend/app/agents/validator.py`
- `backend/app/agents/emit.py`
- `backend/app/retrieval/index.py` — singleton in-process BM25 + dense matrix
- `databricks/notebooks/06_jury.py`
- `databricks/notebooks/07_tiebreaker.py`
- `databricks/notebooks/08_aggregates.py`
- `databricks/notebooks/09_trust_scores.py`

### Updated dependencies (`backend/pyproject.toml` or `requirements.txt`)

- `rank-bm25` (in-process BM25)
- `tenacity` (retry — likely already present)

---

## 12. Testing

Manual only. No unit tests unless a specific component proves brittle during integration.

- `scripts/sanity_check.py` extended: call `/query` for each of the 3 hero queries; assert no `error` events; finishes with `stream_complete`. Run before commits.
- `scripts/replay_sse.py` (NEW, optional): replay a captured SSE log to localhost so partner can iterate on rendering without a live backend. Build only if it saves obvious time.

---

## 13. Out of scope (explicit non-goals)

- Semantic re-check in validator (only structural offset verification). Defer to post-MVP.
- Live jury (always pre-computed + replayed). Defer to post-MVP.
- Embedding ensemble. Single `gte-large-en` only.
- Cross-encoder reranker. LLM rerank only.
- Mosaic Vector Search. Self-built hybrid only.
- Bootstrap CIs on regional aggregates. Stretch if writeup time permits.
- Hand-labeled validation set / reliability curve. Stretch.

---

## 14. Open seams to Phase B (frontend)

Partner needs to consume these contracts:

- `/query` SSE — full event taxonomy in §6, ordering in §6 wire ordering
- `/facilities/all` — JSON pin list for map
- `/facilities/{id}` — drill-down drawer
- `/crisis-map` — district choropleth + drawer

Recommend `scripts/replay_sse.py` as the contract surface partner tests against.
