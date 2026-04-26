# Sanjeevani — State of Play

> Last updated: 2026-04-26
> Hackathon: Hack-Nation × World Bank Global AI Hackathon 2026, Challenge 03 (Databricks)
> Team: 2 people (Track A = data/ML/backend, Track B = frontend)

## TL;DR

**Backend:** ✅ done — full 11-node Verifiable Consensus pipeline streaming over SSE. All 3 hero queries pass integration test with 0 errors. Validator approves citations. Jury verdicts come from pre-computed Delta tables.

**Frontend:** ⚠️ status unknown — partner is driving this; integration with the new SSE contract has not been verified.

**Demo:** ⏳ not rehearsed yet. Live runs are ~110s per chat query — needs trimming or pre-recorded fallback.

---

## What's done

### Data foundation (Databricks)

| Table | Rows | Status |
|---|---|---|
| `bronze.facilities_raw` | 10,000 | ✅ |
| `silver.facilities_parsed` | 10,000 | ✅ |
| `silver.facilities_extracted` | 177 | ✅ Llama 3.3 capability extraction over the hero-query subset |
| `silver.facility_claims` | 127 | ✅ One row per surfaced capability claim with stable `claim_id` and source-text offsets |
| `gold.facility_embeddings` | 177 | ✅ 1024-dim `gte-large-en` |
| `gold.trust_verdicts` | 381 | ✅ 3 judges (Sonnet 4.6 / Llama 3.3 70B / Qwen3-Next 80B) × 127 claims |
| `gold.tiebreaker_verdicts` | 24 | ✅ Sonnet ext-thinking resolution of the split claims |
| `gold.region_capability_stats` | populated | ✅ Powers `/crisis-map` |
| `gold.trust_scores` | 10,000 | ✅ 4-dim trust badge per facility |

### Backend (FastAPI + LangGraph)

11-node pipeline, all wired and tested:

```
planner → intent → sql_prefilter → hybrid_retrieve → rerank
       → moa_propose → aggregator → jury_lookup → tiebreaker → validator → emit
```

| Endpoint | Purpose |
|---|---|
| `POST /query` | SSE stream of the full trace + chat answer |
| `GET /facilities/all` | All 10k pins for the map (lru_cached) |
| `GET /facilities/{id}` | Drill-down detail incl. 4-dim trust_badge |
| `GET /crisis-map?capability=&state=` | District-level desert query |
| `GET /health` | Liveness |

SSE event taxonomy (14 types): `thinking_delta`, `agent_step_start/end`, `tool_call`, `model_proposal`, `jury_verdict`, `tiebreaker_resolved`, `validator_check`, `ranked_card`, `citation`, `text_delta`, `exclusion`, `stream_complete`, `error`.

### Hero queries (all pass integration test)

| # | Query | State | Endpoint | Result |
|---|---|---|---|---|
| Q1 | "Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors." | Bihar | `/query` | 50KB SSE, 3 cards, 6 exclusions, validator approved, ~110s |
| Q2 | "Which Bihar hospitals can I trust for round-the-clock ICU care? A lot of listings advertise it but I only want ones where the description actually backs it up." | Bihar | `/query` | 51KB SSE, 3 cards, 6 exclusions, 2 supported + 1 partial jury verdicts, ~110s |
| Q3 | "Where are the pediatric ICU deserts across Tamil Nadu?" | Tamil Nadu | `/crisis-map?capability=picu&state=Tamil Nadu` | JSON, 9 districts |

Q2 was pivoted from the original Mumbai radiation oncology framing because Mumbai jury coverage is structurally too thin (3 juried claims). Bihar 24/7 ICU has 19 juried claims with mostly partial/unsupported verdicts — the strongest "many claim, few prove" demo in the dataset.

---

## How to run locally

### Backend

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
# or for dev: uvicorn app.main:app --reload
```

Lifespan startup:
1. Enables `mlflow.langchain.autolog()` (traces land in your Databricks workspace experiment if `MLFLOW_EXPERIMENT_NAME` is set)
2. Loads the in-process retrieval index (BM25 + 1024-dim dense matrix over the 177 enriched facilities, ~10-20s)

### Integration test

```bash
bash scripts/integration_check.sh
```

Hits Q1 (`/query`), Q2 (`/query`), Q3 (`/crisis-map`) and prints SSE event-type counts. Files land in `/tmp/sanjeevani_test/{q1,q2,q3}.{sse,json}`. Pass criteria: each query has `error: 0` and `stream_complete: 1` (or for q3, a non-empty `districts` array).

### Required environment variables (in `.env`)

```
AWS_BEARER_TOKEN_BEDROCK=<bedrock bearer token>
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6
BEDROCK_MODEL_ID_HAIKU=us.anthropic.claude-haiku-4-5-20251001-v1:0
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
DATABRICKS_TOKEN=<personal access token>
DATABRICKS_LLAMA_ENDPOINT=databricks-meta-llama-3-3-70b-instruct
DATABRICKS_EMBEDDING_ENDPOINT=databricks-gte-large-en
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_NAME=/Users/<you>/sanjeevani-traces
```

Pip deps notably required: `rank-bm25`, `anthropic>=0.97`, `tenacity`, `openai`, `pydantic`, `fastapi`, `uvicorn`, `databricks-sql-connector`, `numpy`.

### Databricks workspace

Notebooks under `databricks/notebooks/` (run in order if rebuilding from scratch):
- `00_setup_uc.py` — UC catalog + schemas
- `01_bronze_silver.py` — load CSV → bronze + silver parsed
- `02_extract.py` — Llama 3.3 capability extraction + `silver.facility_claims` derivation (also has a backfill cell for already-extracted rows)
- `05_embeddings.py` — `gte-large-en` embeddings, idempotent
- `06_jury.py` — 3-model jury (Sonnet via Bedrock + Llama + Qwen via DBMS); needs `AWS_BEARER_TOKEN_BEDROCK` in secret scope `sanjeevani`
- `07_tiebreaker.py` — Sonnet ext-thinking resolves split jury claims
- `08_aggregates.py` — `gold.region_capability_stats`
- `09_trust_scores.py` — 4-dim trust badges

---

## Known limitations / honest caveats

1. **Latency.** End-to-end query takes ~110s. Aggregator's 4500-token thinking budget alone is ~40s. Trimming to 2000 saves ~25s with mild quality cost.
2. **Q2 is Bihar, not Mumbai.** Spec originally had a Mumbai oncology query but Mumbai jury coverage is too thin (~3 claims). Pivoted to Bihar 24/7 ICU verification, which exercises the same "verification under inflated claims" muscle.
3. **Jury coverage is small (~127 claims, 177 facilities).** Off-script queries that pick non-juried facilities will get cards with `meta: {jury: "not_pre_computed"}` and trust_score = 0. Graceful but visually flat. Backfilling more claims is cheap (~$10) if needed.
4. **Crisis-map data is sparse.** Only 9 TN districts came back for PICU. Choropleth will look thin. Could broaden if needed.
5. **MoA proposers actually parallelize**, but the simple test (no big prompt) shows ~2x speedup, while the full-prompt run is closer to 1.3x. Network latency on each call dominates.
6. **Tiebreaker is rare.** Of the 24 split jury claims pre-computed, our hero queries don't trigger any (the jury reaches consensus on those facilities). Tiebreaker is wired and works — the live-fallback path was tested via standalone smoke — but you won't see a `tiebreaker_resolved` event in a clean Q1/Q2 run.
7. **Validator is structural-only** (checks citation offsets, not semantic correctness). Spec deliberately deferred semantic re-check. After today's aggregator fix, validator passes ✅ on Q1 and Q2.

---

## What's left

### Definitely needed for demo

- **Sync with partner on frontend wiring** — biggest unknown. Backend SSE contract is documented in `docs/superpowers/specs/2026-04-25-backend-trace-pipeline-design.md` §6. Q1/Q2 SSE captures are at `/tmp/sanjeevani_test/{q1,q2}.sse` if your partner needs replay material to develop against.
- **Demo rehearsal + recorded backup** — 110s live runs are tight for a 5-min demo slot. Either trim aggregator thinking budget (4500 → 2000, saves ~25s) or pre-record the SSE stream as a "perfect take" fallback.

### Strong nice-to-haves

- **Verify MLflow autolog is capturing traces.** Lifespan calls `mlflow.langchain.autolog()` but I haven't confirmed traces land in your Databricks experiment. Worth a screenshot for the deck (challenge stretch goal #1, "Agentic Traceability").
- **Pitch deck.** Challenge §6 weights: 35% discovery & verification, 30% IDP innovation, 25% social impact, 10% UX. Q2 is *gold* for the verification narrative. 3-5 slides minimum.
- **Crisis map richer data.** Re-run `08_aggregates.py` after broadening jury coverage if the choropleth feels thin.

### Optional polish

- **Speed up by routing planner/MoA-B to Haiku.** Saves ~20s, but loses the "Sonnet is thinking..." narrative beat in the trace.
- **Pre-bake jury verdicts for likely off-script candidates.** Removes "Verdict pending" badges on impromptu judge questions. Cost ~$10.
- **Genie / Agent Bricks integration** as a 12th node. Listed as a challenge stretch goal; real value is fitting the rubric, not the user experience.

### Out of scope (deliberately)

- Live jury (jury verdicts are always pre-computed)
- Embedding ensemble (single `gte-large-en` only)
- Cross-encoder reranker (LLM rerank only)
- Mosaic Vector Search (self-built hybrid, bypasses Free Edition limits)
- Hand-labeled validation set / reliability curve
- Bootstrap CIs on regional aggregates
- Semantic validator re-check

---

## Reference files

- `docs/OVERVIEW.md` — system overview, architecture, all tech decisions
- `docs/CHALLENGE.md` — original challenge spec
- `docs/superpowers/specs/2026-04-25-sanjeevani-build-plan-design.md` — top-level build plan
- `docs/superpowers/specs/2026-04-25-backend-trace-pipeline-design.md` — Phase B2 design (this is the spec the backend implements)
- `docs/superpowers/plans/2026-04-25-phase-a1-b1-thin-slice.md` — Phase A1+B1 plan
- `docs/superpowers/plans/2026-04-25-phase-b2-trace-pipeline.md` — Phase B2 plan
- `scripts/integration_check.sh` — hero-query smoke test
- `scripts/sanity_check.py` — bedrock + databricks connection check (legacy, from Phase A1)

---

## Recent commit highlights

```
0c71f83 spec: pivot Q2 from Mumbai radiation oncology to Bihar 24/7 ICU verification
852656d fix(backend): aggregator citations are now verbatim quotes with real offsets
daf0eee test(integration): hero-query smoke check script
95a6524 feat(backend): add /facilities/all, /facilities/{id}, /crisis-map endpoints
964b6c2 feat(backend): emit node + 11-node orchestrator
a02fba1 feat(backend): jury_lookup + tiebreaker + validator nodes
247d7da feat(backend): aggregator node — Sonnet 4.6 ext-thinking synthesizes proposals
6d2ab6c feat(backend): MoA proposers node — Sonnet ‖ Llama in parallel
671df8b feat(backend): split retriever into sql_prefilter + hybrid_retrieve + rerank
02256e0 feat(backend): planner node — Sonnet 4.6 ext-thinking
b31f3dc feat(backend): in-process BM25 + dense matrix index
1827ef7 feat(databricks): add 06_jury — three-model Verifiable Consensus pipeline
b776664 feat(databricks): extend 02_extract — emit silver.facility_claims, broaden subset
```
