# Sanjeevani — 24-Hour Build Plan

**Date:** 2026-04-25
**Team:** 2 people, vertical split (Track A = data/ML, Track B = app/UX)
**Source of truth for system design:** [`docs/OVERVIEW.md`](../../OVERVIEW.md)
**This document:** sequencing, parallelization, scope cuts, data contracts, and definitions-of-done.

---

## 1. Strategy Summary

Approach: **thin slice first, then parallel tracks, then converge.** A working end-to-end demo of one hero query exists at H+2; the remaining 22 hours scale and polish.

The offline data pipeline is **incremental and idempotent** (Delta `MERGE INTO` keyed on `facility_id`). Every step skips rows already processed, so thin-slice work is reused, never reprocessed.

Core narrative preserved: **Verifiable Consensus** — multi-model jury offline + validator agent online. Frontend chain-of-thought UX is the demo moment.

## 2. Hero Queries (the demo script)

| # | Query | Showcases | Earliest demoable |
|---|---|---|---|
| Q1 | *"nearest rural Bihar facility for emergency appendectomy with part-time doctors"* (verbatim from challenge brief §2.2) | Multi-attribute reasoning, hybrid retrieval, agent trace UX | H+2 (thin slice) |
| Q2 | *"facilities claiming advanced surgery but flagged by the trust scorer"* | Multi-model jury, citation hover, trust panel | H+9 (after jury) |
| Q3 | *"oncology deserts across India — which districts have no verified facility?"* | Crisis map overlay, regional aggregates | H+14 (mid-B8, first interactive overlay) |

## 3. Repo Structure

```
sanjeevani/
├── README.md
├── data/india_healthcare_facilities.csv
├── docs/
│   ├── CHALLENGE.md
│   ├── OVERVIEW.md                                  # design source-of-truth
│   ├── challenge-brief.pdf
│   └── superpowers/specs/
│       └── 2026-04-25-sanjeevani-build-plan-design.md   # this file
├── databricks/                                      # Track A
│   ├── notebooks/
│   │   ├── 01_bronze_silver.py                      # CSV → Delta, parse, normalize
│   │   ├── 02_extract.py                            # Llama 3.3 capability extraction
│   │   ├── 03_trust_rules.py                        # deterministic rule flags
│   │   ├── 04_jury.py                               # 3-model jury verdicts
│   │   ├── 05_embeddings.py                         # gte-large-en, ARRAY<FLOAT> in Delta
│   │   ├── 06_aggregates.py                         # state + district capability stats
│   │   └── 07_trust_scores.py                       # 4-dim trust badge
│   └── lib/
│       ├── prompts.py                               # extraction + jury prompts
│       ├── schemas.py                               # pydantic models
│       └── clients.py                               # Bedrock + Model Serving wrappers
├── backend/                                         # Track B
│   ├── pyproject.toml
│   ├── .env.example
│   ├── app/
│   │   ├── main.py                                  # FastAPI + SSE endpoint
│   │   ├── agents/
│   │   │   ├── graph.py                             # LangGraph wiring
│   │   │   ├── intent.py
│   │   │   ├── retriever.py
│   │   │   ├── moa.py
│   │   │   ├── validator.py
│   │   │   └── prompts.py
│   │   ├── retrieval/
│   │   │   ├── indexes.py                           # build BM25 + dense at startup
│   │   │   └── hybrid.py                            # RRF fusion
│   │   ├── data/
│   │   │   ├── databricks_sql.py
│   │   │   └── schemas.py
│   │   ├── llm/
│   │   │   ├── bedrock.py
│   │   │   └── model_serving.py
│   │   └── streaming/sse.py                         # SSE event types + serializer
│   └── tests/
├── frontend/                                        # Track B (Next.js 16)
│   ├── package.json
│   ├── next.config.js                               # cacheComponents: true
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                                 # explorer (map + chat)
│   │   ├── api/stream/route.ts                      # proxy SSE from FastAPI
│   │   └── facility/[id]/page.tsx                   # facility drawer
│   ├── components/
│   │   ├── chat/{chat,message,thinking-block,trace-panel,jury-panel,citation-pill}.tsx
│   │   ├── map/{india-map,crisis-overlay}.tsx
│   │   └── trust/{trust-badge,facility-drawer}.tsx
│   └── lib/{sse,api}.ts
└── scripts/
    └── playwright-demo-test.ts                      # self-test the 3 hero queries
```

## 4. Data Contracts (the integration seam)

The Track A ↔ Track B handoff is exactly these Unity Catalog tables. Schemas locked in §1 of build; no changes after H+2.

**Catalog:** `sanjeevani` · **Schemas:** `bronze`, `silver`, `gold`

### `bronze.facilities_raw`
Verbatim CSV columns. 41 fields. Primary key: synthetic `facility_id` (UUID generated at load).

### `silver.facilities_parsed`
```
facility_id            STRING  PK
name                   STRING
phone_numbers          ARRAY<STRING>            -- parsed from JSON
official_phone         STRING
email                  STRING
websites               ARRAY<STRING>
address_line1..3       STRING
city                   STRING
state                  STRING                   -- normalized
pincode                STRING
district               STRING                   -- mapped from pincode (Census 2011)
is_rural               BOOLEAN                  -- from district classifier
latitude               DOUBLE
longitude              DOUBLE
facility_type          STRING                   -- 'hospital'|'clinic'|'dentist'|'doctor'|'pharmacy'
operator_type          STRING
specialties            ARRAY<STRING>            -- parsed from JSON
procedure_list         ARRAY<STRING>
equipment_list         ARRAY<STRING>
capability_list        ARRAY<STRING>
description            STRING
number_doctors         INT
capacity               INT
recency_of_page_update STRING
trust_meta             STRUCT<                  -- all the meta-signal columns
  social_count: INT,
  affiliated_staff: BOOLEAN,
  custom_logo: BOOLEAN,
  num_facts: INT,
  followers: INT,
  likes: INT,
  engagements: INT,
  last_post_date: STRING
>
```

### `silver.facilities_extracted`
LLM-extracted structured capabilities per facility. **Idempotent** — `MERGE INTO` on `facility_id`.
```
facility_id              STRING  PK
explicit_capabilities    ARRAY<STRING>
implicit_capabilities    ARRAY<STRING>
surgery_capable          BOOLEAN
emergency_24_7           BOOLEAN
staff_mentioned          ARRAY<STRING>
equipment_mentioned      ARRAY<STRING>
operating_hours_text     STRING
urgent_care_signals      ARRAY<STRING>
extracted_at             TIMESTAMP
extractor_model          STRING                 -- 'llama-3-3-70b'
```

### `silver.trust_rules`
```
facility_id   STRING  PK
rule_flags    ARRAY<STRUCT<
  rule_id: STRING,
  severity: STRING,
  evidence_columns: ARRAY<STRING>,
  evidence_excerpt: STRING
>>
computed_at   TIMESTAMP
```

### `gold.trust_verdicts`
**Idempotent on (`facility_id`, `capability`).** One row per (facility × capability claim).

Capability enumeration (locked list — must be the same across jury, aggregates, and crisis map):
`appendectomy`, `general_surgery`, `anesthesia`, `cardiology`, `cardiac_surgery`, `oncology`, `dialysis`, `neonatal_icu`, `pediatrics`, `emergency_24_7`, `trauma`, `obstetrics`, `radiology`, `pathology`, `dentistry`. Plus a free-form `other` for any specialty surfaced in extraction not in the list.
```
facility_id           STRING
capability            STRING                    -- 'appendectomy', 'cardiology', etc.
judge_verdicts        ARRAY<STRUCT<
  judge_model: STRING,                          -- 'sonnet-4-6' | 'llama-3-3-70b' | 'qwen3-next-80b'
  verdict: STRING,                              -- 'supported' | 'partial' | 'unsupported' | 'unknown'
  confidence: DOUBLE,
  citation_excerpt: STRING,
  citation_column: STRING,
  citation_char_start: INT,
  citation_char_end: INT,
  reasoning: STRING
>>
agreement_rate        DOUBLE                    -- 0.0-1.0
consensus_verdict     STRING
dissent_notes         STRING
verdicts_at           TIMESTAMP
```

### `gold.facility_embeddings`
**Idempotent on `facility_id`.**
```
facility_id    STRING  PK
embedding      ARRAY<FLOAT>                     -- 1024 dims, gte-large-en
embedding_text STRING                           -- concatenated source text
embedded_at    TIMESTAMP
```

### `gold.region_capability_stats`
```
region_type        STRING                       -- 'state' | 'district'
region_id          STRING                       -- state name | district code
capability         STRING
facilities_count   INT
verified_count     INT                          -- jury_agreement >= 0.67 AND verdict != 'unsupported'
mean_trust_score   DOUBLE
gap_severity       DOUBLE                       -- 0.0-1.0 (high = bigger desert)
computed_at        TIMESTAMP
```

### `gold.trust_scores`
```
facility_id    STRING  PK
existence      DOUBLE                           -- 0-100
coherence      DOUBLE
recency        DOUBLE
specificity    DOUBLE
computed_at    TIMESTAMP
```

## 5. Track A — Data/ML Phases

Each phase has a **DoD** (definition of done) — clear, testable signal that it's complete.

### A1. Bronze + Silver foundation (H0–H1.5, joint phase)
Build first because Track B needs the schema even with empty tables.
- Load CSV → `bronze.facilities_raw` (10k rows)
- Parse JSON-ish columns, normalize states
- Map pincode → district + rural flag (Census 2011 lookup; offline CSV)
- Validate lat/long
- Write `silver.facilities_parsed`
- **DoD:** `SELECT COUNT(*) FROM silver.facilities_parsed WHERE district IS NOT NULL AND latitude IS NOT NULL` returns ≥9,800.

### A2. Extraction (H2–H3, then incremental)
- Llama 3.3 70B via `databricks-meta-llama-3-3-70b-instruct`
- Structured output (pydantic-validated JSON)
- Concurrency: `asyncio.gather` with semaphore=10, exp backoff on 429
- **Idempotent**: `MERGE INTO silver.facilities_extracted` on `facility_id`
- **Thin-slice subset:** 100 Bihar rows at H0-2; remaining 9,900 starting H+2
- **DoD:** `SELECT COUNT(*) FROM silver.facilities_extracted` = 10,000 by H+3

### A3. Rule-based trust (H3–H3.5)
- 8 deterministic rules (claims surgery without anesthesia, etc. — full list in `databricks/lib/prompts.py`)
- Pure Python, runs in seconds
- **DoD:** `silver.trust_rules` populated for all 10k; ≥5% have at least one flag (sanity check).

### A4. Multi-model jury (H3.5–H7) — the long pole
- 3 judges in parallel: Sonnet 4.6 (Bedrock), Llama 3.3 (DB Model Serving), Qwen3-Next 80B (DB Model Serving)
- Per facility: verdict each capability claim, with citation
- `asyncio.gather([sonnet_call, llama_call, qwen_call])` per row → write all three to `gold.trust_verdicts`
- Exp backoff on 429s
- **Acceptance criterion if quota throttles**: at H+6, accept partial coverage (≥7,500 rows verdicted) and proceed
- **DoD:** ≥9,500 rows have all 3 judge verdicts in `gold.trust_verdicts` by H+7

### A5. Embeddings (H7–H8)
- `databricks-gte-large-en`, batch=64
- Concat: `name + " " + description + " " + capabilities + " " + procedures`
- **Idempotent:** MERGE on `facility_id`
- **DoD:** `gold.facility_embeddings` has 10,000 rows × 1024-float vectors.

### A6. Aggregates (H8–H10)
- State-level required for MVP; district-level if time
- `gold.region_capability_stats`
- **DoD:** state-level rows for ≥15 priority capabilities (oncology, cardiology, neonatal, dialysis, trauma, surgery, etc.) computed.

### A7. Trust scores (H8–H9, parallel with A6)
- 4-dim badge per facility, computed from rules + jury + meta-signals
- **DoD:** `gold.trust_scores` populated for all 10k.

**At H10–12, Person A pivots to Track B support.**

## 6. Track B — App/UX Phases

### B1. FastAPI + LangGraph skeleton (H0–H1, joint phase)
- FastAPI w/ CORS, single SSE endpoint `POST /query → stream events`
- LangGraph: 3 nodes (intent → retrieve → answer), single-proposer
- Bedrock client (Sonnet 4.6) + Databricks Model Serving client + Databricks SQL client
- MLflow autolog enabled (`mlflow.langchain.autolog()`)
- **DoD:** `curl -N POST /query` returns streamed SSE events for a fixed test query.

### B2. Hybrid retrieval (H1–H2 in thin slice; full at H6)
- BM25 via `rank-bm25`, dense via NumPy cosine
- RRF k=60
- Indexes loaded from Delta on FastAPI startup
- **DoD thin slice:** retrieves top-10 from a 100-row Bihar subset
- **DoD full:** retrieves top-10 from all 10k after embeddings done at H+8

### B3. Next.js scaffold (H1–H2 thin slice; expanded at H+5)
- Next.js 16.2 App Router, TypeScript, `cacheComponents: true`
- shadcn/ui + Tailwind installed
- Single `/` page with chat input + raw response display (thin slice)
- **DoD:** `npm run dev` shows working chat that streams from FastAPI.

### B4. Custom SSE consumer + chat UX (H2–H6)
- Event types: `thinking_delta`, `agent_step_start/end`, `tool_call`, `model_proposal`, `consensus_resolved`, `text_delta`, `citation`
- React component per event type, distinct rendering
- Trace panel = vertical timeline of agent steps
- Thinking block = collapsible italic gray
- **DoD:** all 7 event types render correctly when backend emits a synthetic test sequence.

### B5. Map page (H5–H7)
- MapLibre GL JS + deck.gl ScatterplotLayer over 10k pins
- Filter sidebar: state, facility type, specialty
- Click pin → facility drawer
- **DoD:** all 10k pins load, filtering works, click opens drawer.

### B6. Trust panel + jury widget (H7–H9)
- 4-bar trust badge component (existence/coherence/recency/specificity)
- Jury panel: 3 judge verdicts side-by-side with agreement rate
- Sentence-citation hover (highlights span in `description`)
- Facility drawer integrates all of the above
- **DoD:** all three render correctly for a single test facility.

### B7. MoA upgrade + validator (H9–H12)
- Upgrade single-proposer → dual-proposer + Sonnet aggregator with extended thinking
- Add validator node after MoA
- Stream `model_proposal` events for both proposers in parallel
- Stream `consensus_resolved` event after aggregator
- **DoD:** chat shows two proposer cards side-by-side, then aggregator's reconciliation, then validator's pass/flag.

### B8. Crisis map overlay (H12–H16, joint after Person A pivots)
- Choropleth layer on top of facility pins, colored by `gap_severity`
- Capability dropdown (oncology, dialysis, etc.)
- State-level for MVP; district-level if time
- Click region → query auto-fills "facilities for X in Y"
- **DoD:** toggling capability re-colors map; Q3 hero query lights up the visible deserts.

### B9. Polish + hero query rehearsal (H16–H20)
- Connect map ↔ chat (bidirectional)
- Loading states, empty states, error toasts
- Citation drawer animations
- "Why not these?" panel — only if time at H+18
- Genie tool integration — only if time at H+18
- **DoD:** all 3 hero queries work end-to-end with no obvious UX gaps.

### B10. Demo hardening (H20–H24, joint)
- Playwright self-test scripts each hero query, asserts key UI invariants
- Fix any regressions Playwright finds
- Screen-record 3 queries as backup
- 3-5 slide pitch deck
- **DoD:** all Playwright tests green; recordings saved.

## 7. Explicit Scope Cuts (vs. OVERVIEW.md)

### CUT for MVP — mention in pitch
- LLM rerank inside hybrid retrieval (use RRF top-10 directly into MoA)
- "Why not these?" inverse panel
- Genie tool integration
- District-level crisis map (state-level only)
- Cross-encoder reranker
- Hand-labeled validation set
- Embedding ensemble
- Bootstrap confidence intervals on aggregates
- Agent Bricks deployment

### KEPT critical — non-negotiable
- Full multi-model jury offline on all 10k (3 judges)
- MoA online (dual proposer + aggregator) — single-proposer at H+2 thin slice, upgraded by H+12
- Validator agent
- MLflow 3 autolog tracing
- Custom SSE chain-of-thought UX (all 7 event types)
- Map + chat + trust panel + state-level crisis overlay
- All 3 hero queries
- Sentence-level citations end-to-end

### CONDITIONAL — only if time at H+18
- District-level crisis map (replaces state-level if both exist)
- "Why not these?" inverse panel
- Genie tool integration

## 8. Configuration & Environment

I'll prompt for these at the moment we need them — listed here for reference.

### Needed by H+1 (before backend skeleton runs)
```
AWS_BEARER_TOKEN_BEDROCK=<bearer-token>
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6
BEDROCK_MODEL_ID_HAIKU=us.anthropic.claude-haiku-4-5
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<personal-access-token>
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
DATABRICKS_LLAMA_ENDPOINT=databricks-meta-llama-3-3-70b-instruct
DATABRICKS_QWEN_ENDPOINT=databricks-qwen3-next-80b-a3b-instruct
DATABRICKS_EMBEDDING_ENDPOINT=databricks-gte-large-en
DATABRICKS_GENIE_SPACE_ID=<space-id>
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_NAME=/Users/<user>/sanjeevani-traces
UC_CATALOG=sanjeevani
```

### Needed by H+0.5 (frontend scaffold)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## 9. Risk Register

| Risk | Mitigation | Trigger to act |
|---|---|---|
| Bedrock auth fails | Verify with `boto3.client("bedrock-runtime").invoke_model` before agent code | H+0.5 — if not working, stop everything until fixed |
| Databricks SQL Warehouse cold start | Wake warehouse at H0 with `SELECT 1` | H+0.5 |
| Model Serving throttle on jury | `asyncio.Semaphore(5)` per endpoint, exp backoff | H+4 if jury slows |
| Frontend SSE complexity | Start with one event type at H+2, add others incrementally | H+4 if trace panel still TODO |
| Track B overrun (>14h) | Person A pivots earlier, H+8 instead of H+12 | H+10 self-check |
| District mapping data missing | Fallback to state-only crisis map | H+9 if district join fails |
| Demo flakes during recording | Pre-recorded screen capture as backup | H+22 — record both live and pre-recorded |

## 10. Definition of Done — Project Level

The 24-hour window ends successfully when **all** of these are true:

1. ✅ All 3 hero queries return cited, trust-badged answers via the chat UI
2. ✅ Live agent trace panel shows multi-step reasoning during each query
3. ✅ Map renders 10k pins; crisis-map overlay toggles by capability
4. ✅ Multi-model jury verdicts visible on at least one demo facility (jury panel widget)
5. ✅ MLflow 3 trace exists for at least one query, viewable in Databricks workspace
6. ✅ Validator agent visible in trace as a distinct post-MoA step
7. ✅ Pitch deck (3-5 slides) and a backup screen recording exist
8. ✅ Repo is committed; README updated with how-to-run

---

## 11. Next Step

After user reviews this spec, invoke `superpowers:writing-plans` to produce the detailed implementation plan for **Phase A1+B1 (joint thin-slice kickoff)** — the first 2 hours. Subsequent phases get their own plans.
