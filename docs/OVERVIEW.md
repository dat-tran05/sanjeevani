# Sanjeevani — System Overview

> *Sanjeevani — the mythical life-saving herb. Find help, save lives.*
>
> An agentic healthcare intelligence system for India's 10,000+ medical facilities.
> Built for **Hack-Nation × World Bank Global AI Hackathon 2026**, Challenge 03 (powered by Databricks).

This document is the high-level concept brief. Read [`CHALLENGE.md`](./CHALLENGE.md) for the full challenge spec.

---

## 1. The Mission

In India, a postal code often determines a lifespan. 70% of the population lives in rural areas where healthcare access is a discovery and coordination crisis: patients travel hours to find the wrong facility. We have a 10,000-row dataset of facilities — but it's messy, inconsistent, and full of unverifiable claims.

Sanjeevani turns that static list into a **reasoning layer**. NGO planners and patients ask natural-language questions ("nearest rural Bihar facility for emergency appendectomy") and get cited, trust-scored, multi-model-verified recommendations — plus a map view of where the medical deserts are.

## 2. The Dataset Reality (what shapes our design)

10,000 rows × 41 columns. Profiled empirically:

| Reality | Implication for design |
|---|---|
| 100% have lat/long, all 28 states/UTs | Geographic features are reliable; map is a first-class UI |
| Facility-type skew: 60% clinics, 28% hospitals, 7% dentists | Pre-filter aggressively; high-acuity queries need hospital subset |
| Top states: Maharashtra (1.5k), UP (1.1k), Bihar (429) | Rural-Bihar query is *plausible* but candidate pool is small |
| `equipment` 84% null, `procedure` 66% null, `capability` 36% null | Sparsity is the dominant problem — agents must reason under uncertainty |
| `numberDoctors` 94% null, `capacity` 99% null | Headcount/bed claims are essentially absent |
| `specialties` 100% populated but auto-tagged (familyMedicine on 66%) | These are *derived labels*, not self-reported claims — can't be trusted at face value |
| `description` >20 chars on 79.5% of rows | Free text is the richest signal we have for capability extraction |
| Trust signals (recency, social presence, logo, staff) are unusually rich | Independent meta-signals power the "is this listing real?" axis |

Two consequences drive everything: **we must extract structure from the free text offline**, and **we must verify claims with multi-model consensus because there is no ground truth**.

## 3. The Product

Three integrated experiences in one app:

**A. Conversational explorer** — chat where users ask multi-attribute questions and get ranked, cited, trust-badged recommendations. The chat shows reasoning live: extended-thinking blocks, agent decisions, jury verdicts.

**B. Map dashboard** — interactive map of all 10k facilities with a *medical-desert overlay*: districts colored by verified capability gaps (e.g., "districts with >100k population and zero verified emergency surgery").

**C. Trust drill-down** — click any facility → see its 4-dimension trust badge (Existence, Coherence, Recency, Specificity), the multi-model jury verdicts with dissent, and sentence-level citations highlighted in the source description.

## 4. The Big Idea — Verifiable Consensus

> *"When there is no answer key, we use disagreement between heterogeneous models as our calibration signal."*

This is the technical narrative that ties everything together and addresses the challenge's central problem ("no ground truth, agents that double-check their own work" — eval criterion #1, 35%).

We use three orthogonal patterns from the literature, applied to three different jobs:

| Pattern | Used for | Where |
|---|---|---|
| **Multi-model jury** (independent verdicts → vote) | Trust scoring of capability claims | Offline, all 10k facilities |
| **Mixture of Agents (MoA)** (parallel proposers → aggregator) | User query reasoning | Online, per request |
| **Validator agent** (independent re-check, query-aware) | Final answer verification | Online, after MoA |

Heterogeneity comes from running judges with different training corpora: **Claude Sonnet 4.6** (Anthropic, via Bedrock), **Llama 3.3 70B** (Meta, via Databricks Model Serving), **Qwen 3 80B** or **DBRX** (Databricks-hosted). Three-way disagreement → escalation to a senior-judge tiebreaker.

## 5. Architecture — Two Layers

### 5.1 Offline Enrichment Pipeline (Databricks-native)

Runs once against the 10k-row CSV. Produces enriched Delta tables that the runtime agents query. Without this layer, every user query would call LLMs to interpret raw messy text — slow, expensive, inconsistent.

```
data/india_healthcare_facilities.csv  (10k raw rows)
        │
        ▼
[1] LOAD          → bronze.facilities_raw (Delta, Unity Catalog)
        │
        ▼
[2] PARSE         → silver.facilities_parsed
        │   - Parse JSON-ish columns (specialties, procedure, equipment, capability)
        │   - Normalize "null" sentinels, state/city spellings
        │   - Map PIN code → district + rural/urban classifier (Census 2011)
        │   - Validate lat/long in India bbox
        ▼
[3] EXTRACT       → silver.facilities_extracted
        │   LLM (Llama 3.3, Databricks Model Serving) reads description + capability
        │   prose. Outputs structured JSON: explicit_capabilities,
        │   implicit_capabilities, surgery_capable, emergency_24_7,
        │   staff_mentioned, equipment_mentioned, operating_hours, urgent_signals
        ▼
[4] RULE-CHECK    → silver.trust_rules
        │   Deterministic Python. Eight rules e.g.:
        │   - claims surgery & no anesthesia
        │   - clinic claiming high-acuity specialty (oncology, neurosurgery)
        │   - >5 specialties & numberDoctors=null  (thin staffing)
        │   - cardiology specialty & no cath/ECG/cardiac procedure
        ▼
[5] JURY          → gold.trust_verdicts                           ← THE BIG ONE
        │   For each facility, three judges independently verdict each
        │   capability claim: { supported | partial | unsupported,
        │                       confidence, citation_excerpt, dissent_notes }
        │   - Judge A: Claude Sonnet 4.6 (Bedrock)
        │   - Judge B: Llama 3.3 70B (Databricks Model Serving)
        │   - Judge C: Qwen 3 80B / DBRX (Databricks Model Serving)
        │   Aggregate: agreement_rate, consensus_verdict
        │   When all three disagree → escalate to Sonnet 4.6 with
        │   extended thinking budget as tiebreaker.
        ▼
[6] EMBED         → gold.facility_embeddings
        │   gte-large-en (Databricks Foundation Model API). Embedding
        │   vectors stored as ARRAY<FLOAT> column in Delta. NOT indexed
        │   in Mosaic Vector Search (Free Edition caps at 1 endpoint /
        │   1 unit and lacks Direct Vector Access). Hybrid retrieval
        │   indexes are built in-process at FastAPI startup — see §5.4.
        ▼
[7] AGGREGATE     → gold.region_capability_stats
        │   Group by (district × capability):
        │   facilities_count, verified_count (jury_agreement >= 0.67),
        │   mean_trust_score, gap_severity_score.
        │   Powers the medical-desert choropleth.
        ▼
[8] SCORE         → gold.trust_scores
        │   Combine rule flags + jury verdicts + meta-signals into the
        │   4-dim badge: existence / coherence / recency / specificity.
```

**Cost estimate:** ~2-3 hours wall time, ~$60-120 cloud spend (jury dominates; Llama/Qwen on Databricks free tier are quota-bound but free).

**Cadence:** run once per dataset version. Re-run if rules or judge prompts change.

### 5.2 Online Agent Service (FastAPI + LangGraph)

Runs on the dev box. Connects out to Databricks (data, vector, models) and Bedrock (Anthropic models). Streams reasoning to the Next.js frontend over SSE.

```
                            ┌────────────────────────────────────┐
                            │     Next.js 16 (dev server)        │
                            │   App Router, cacheComponents on   │
                            │   Map | Chat | Trace Panel | Trust │
                            └───────────┬────────────────────────┘
                                        │ SSE (custom event stream)
                            ┌───────────▼────────────────────────────┐
                            │     FastAPI + LangGraph                │
                            │     (multi-agent supervisor)           │
                            │  ┌──────────────────────────────────┐  │
                            │  │ In-process retrieval indexes     │  │
                            │  │ (hot-loaded from Delta on start) │  │
                            │  │  - BM25 sparse (rank-bm25)       │  │
                            │  │  - Dense vectors (NumPy / FAISS) │  │
                            │  └──────────────────────────────────┘  │
                            └───────────┬────────────────────────────┘
                                        │
       ┌────────────────────────────────┼─────────────────────────────────┐
       │                                │                                 │
       ▼                                ▼                                 ▼
┌──────────────┐              ┌──────────────────────┐         ┌──────────────────────┐
│ AWS Bedrock  │              │  Databricks          │         │  Databricks          │
│              │              │  Model Serving       │         │  SQL Warehouse       │
│ Sonnet 4.6   │              │                      │         │  + Genie             │
│ Haiku 4.5    │              │  Llama 3.3 70B       │         │                      │
│              │              │  Qwen3-Next 80B      │         │  Gold tables incl.   │
│              │              │  gte-large-en (emb)  │         │  embedding column    │
└──────────────┘              └──────────────────────┘         │  (ARRAY<FLOAT>)      │
                                                               └──────────────────────┘

                    All graph execution traced via MLflow 3
                    (mlflow.langchain.autolog() — every node,
                     tool call, token count, latency captured)
```

### 5.3 Per-query flow (canonical example)

User: *"nearest rural Bihar facility for emergency appendectomy"*

```
[1] Intent agent (Haiku 4.5)
    → {state: "Bihar", capability: "appendectomy", urgency: "emergency",
       setting: "rural", must_have: ["surgery", "anesthesia"]}

[2] Structured filter (Databricks SQL Warehouse via SDK)
    SELECT * FROM silver.facilities_extracted
     WHERE state='Bihar' AND facility_type IN ('hospital','clinic')
       AND is_rural_district = TRUE
    → 180 candidates

[3] Hybrid retrieval (in-process, parallel branches over the 180 candidates)
    Query embedding via Databricks Foundation Model API (gte-large-en)
    ┌─ BM25 sparse  (rank-bm25 over description + extracted_capabilities) → top 100
    └─ Dense        (NumPy cosine on gte-large-en embeddings)             → top 100
    Reciprocal Rank Fusion (RRF, k=60)                                    → top 50

[4] LLM rerank (Llama 3.3 70B on Databricks Model Serving)
    "Given query Q and these 50 candidates, return top 10 ranked
     by capability fit, with one-sentence reasoning each."
    → top 10 with rerank rationale (streamed to trace panel)

[5] Trust filter (SQL on gold.trust_verdicts)
    JOIN trust_verdicts ON facility_id
     WHERE jury_agreement_appendectomy >= 0.67
       AND consensus_verdict_appendectomy IN ('supported','partial')
    → 5-7 candidates

[6] Mixture of Agents (LangGraph subgraph)
    ┌─ Proposer A: Sonnet 4.6 (Bedrock) ─── ranks survivors → top 5 ─┐
    │                                                                 │
    └─ Proposer B: Llama 3.3 (Databricks) ─ ranks survivors → top 5 ─┤
                                                                      │
    Aggregator: Sonnet 4.6 + extended thinking (budget=5000) ◄────────┘
    → final 3 with reconciled reasoning + sentence citations

[7] Validator agent: Sonnet 4.6 (fresh context, query-aware)
    Re-checks: "Given user wants emergency appendectomy in rural Bihar,
                does each of these 3 facilities' evidence actually support
                the recommendation?"
    → confirms or flags

[8] Stream final answer + jury panel + citations + trace to frontend
```

Every node, tool call, model invocation, and token count is captured by MLflow 3 autolog → satisfies stretch goal #1 (Agentic Traceability).

### 5.4 Retrieval Pipeline (self-built hybrid)

We bypass Mosaic AI Vector Search (Free Edition is capped at 1 endpoint / 1 unit and lacks Direct Vector Access) and build retrieval in-process for full transparency and trace inspectability. Embeddings are still generated via the Databricks Foundation Model API (`gte-large-en`) and stored as `ARRAY<FLOAT>` in the gold Delta table — only the *search* layer is self-built.

**Index lifecycle:**
- On FastAPI startup, load `gold.facility_embeddings` and `silver.facilities_extracted` from Delta (one shot, ~30s).
- Build BM25 index over `description + extracted_capabilities + procedure + capability` text using `rank-bm25` (in-memory).
- Hold dense vectors as a single `(N, 1024)` NumPy array; cosine similarity via dot product (10k rows × 1024 dims = ~40MB, trivial).
- Optional FAISS upgrade if scale grows past Free Edition.

**Per-query stages:**

| Stage | Tool | Output | Streamed to UI |
|---|---|---|---|
| 1. Structured prefilter | Databricks SQL Warehouse | ~500 candidate ids | `tool_call: sql_filter` |
| 2a. Sparse retrieval | `rank-bm25` (in-process) | top 100 by BM25 score | `tool_call: bm25_search` |
| 2b. Dense retrieval | NumPy cosine on candidate ids | top 100 by similarity | `tool_call: dense_search` |
| 3. Fusion | Reciprocal Rank Fusion (k=60) | top 50 merged | `agent_step: rrf_fusion` |
| 4. LLM rerank | Llama 3.3 70B (Databricks Model Serving) | top 10 with rationale | `model_proposal: rerank` |
| 5. Trust filter | SQL JOIN on `gold.trust_verdicts` | 5-7 verified candidates | `tool_call: trust_filter` |

Each stage emits a distinct SSE event so the trace panel renders the full pipeline visually — judges literally see the retrieval funnel narrow from 10,000 → 500 → 100/100 → 50 → 10 → 5 in real time. This is a stronger demo artifact than Mosaic's black-box similarity score.

**Why this design:**
- Transparent: every score, every rank, every stage is recorded and renderable.
- Faster than Mosaic for our scale: in-process is microseconds, no network hop.
- Better hybrid: BM25 catches keyword matches Mosaic's pure-dense pipeline misses (e.g., specific procedure names).
- LLM rerank doubles as soft-explanation: "ranked higher because description explicitly mentions emergency operations" — usable as citation.
- No quota anxiety; no 1-endpoint cap.

## 6. The Trust Scorer

### Four dimensions (shown as a 4-bar badge in the UI)

| Dimension | What it measures | Driven by |
|---|---|---|
| **Existence** | Is this place real and operating? | Meta-signals: phone/email/website present, recency, social presence count, custom logo, follower count, recent post date |
| **Coherence** | Do the facility's structured fields agree? | Rule-based contradictions + LLM cross-check between description prose and structured fields |
| **Recency** | How fresh is the listing? | `recency_of_page_update`, social post recency |
| **Specificity** | How much actionable detail vs. vague? | Count of structured items (procedures, equipment, staff specifics) |

**Critical UX rule:** never collapse these into a single number. Low specificity ≠ untrustworthy — it just means sparse. Conflating them is the most common trust-scorer failure mode.

### Citations

Every flag, verdict, and recommendation carries `{facility_id, column, char_start, char_end, source_text}`. The UI renders citations as inline pills that highlight source text on hover. MLflow records which retrieval call surfaced the row, which jury judges voted what, and which sentence each verdict cited. **One-click traceability from recommendation back to evidence.**

## 7. The Frontend (Next.js 16)

### Five UX moves that win the demo

1. **Live agent trace stream.** As the multi-agent system runs, stream each step to a side panel via SSE. Users see "Found 47 candidates → filtered by surgical capability → 12 remain → jury flagged 3 for missing anesthesia → ranking 9 by trust × distance...". This is the brief's transparency requirement turned into the most exciting UX in the app.

2. **Citation-on-hover.** Hover any claim in the answer ("This facility has 24/7 emergency surgery") → tooltip pops with the exact `description` excerpt highlighted. Click → side drawer with full row.

3. **Jury panel widget.** Every recommendation card shows the three judges' verdicts side-by-side with agreement rate. Disagreement is visible, not hidden.

4. **"Why not these?" inverse panel.** Below recommendations, show 3-5 facilities the agent rejected with reasons ("ortho specialty but no surgery procedure ever cited"). Gold for NGO planner trust + matches the brief's "audit at scale" mandate.

5. **Crisis-mapping overlay.** Choropleth by district colored by capability gap severity. Toggle by capability (oncology, dialysis, emergency trauma, neonatal). Click a district → drill-down.

### Stack

- **Next.js 16.2** App Router, TypeScript, React 19
- `cacheComponents: true` for Partial Prerendering (static map shell + cached metadata + dynamic chat panel inside Suspense)
- **shadcn/ui** + Tailwind for design speed
- **MapLibre GL JS** + **deck.gl** ScatterplotLayer (handles 10k pins trivially)
- **Custom SSE consumer** for chain-of-thought streaming — not Vercel AI SDK, because Anthropic's streaming format is richer (thinking blocks, tool_use blocks, multi-content turns) and we want to render every category distinctly
- **TanStack Query** for fetch + cache; **Recharts** for trust badges and desert charts

### Chat event taxonomy

| SSE event | Source | UI render |
|---|---|---|
| `thinking_delta` | Claude extended thinking | gray italic, collapsible "Reasoning..." block |
| `agent_step_start` / `_end` | LangGraph node entry/exit | timeline node with spinner → summary |
| `tool_call` | Tool invocation inside node | tool badge with input/output |
| `model_proposal` | Juror proposes (MoA mode) | side-by-side card, "Proposer A" / "Proposer B" |
| `consensus_resolved` | Aggregator/jury verdict | "✅ 3/3 agree" or "⚠️ 2/3 — dissent: ..." |
| `text_delta` | Final answer tokens | normal chat bubble |
| `citation` | Cited row + char offsets | inline pill, hover-highlights source |

## 8. Tech Stack Summary

| Layer | Tool | Why |
|---|---|---|
| **Frontend** | Next.js 16 App Router + shadcn/ui + Tailwind | Modern, fast, polished UX |
| **Map** | MapLibre GL JS + deck.gl | Free, handles 10k pins, choropleth-friendly |
| **Backend orchestration** | FastAPI + LangGraph 1.0 | Graph-based multi-agent state machine |
| **Streaming** | Custom SSE | Full control over Anthropic event types |
| **LLMs (Anthropic)** | Sonnet 4.6, Haiku 4.5 — via **AWS Bedrock** only | Aligns with team Bedrock setup |
| **LLMs (open)** | Llama 3.3 70B, Qwen 3 / DBRX — via **Databricks Model Serving** | Heterogeneous jury + IDP-Innovation alignment |
| **Embeddings** | `gte-large-en` via Databricks Foundation Model API | Native, single-model (skip ensemble for MVP); stored as `ARRAY<FLOAT>` in Delta |
| **Retrieval (hybrid, self-built)** | `rank-bm25` + NumPy cosine + RRF + LLM rerank (Llama 3.3) | Bypasses Free Edition Mosaic VS limits (1 endpoint / 1 unit / no Direct Vector Access); fully transparent funnel; 4-stage trace per query |
| **Storage** | **Delta Lake on Unity Catalog** (Bronze/Silver/Gold) | Standard Lakehouse pattern |
| **SQL** | **Databricks SQL Warehouse** | Agent-callable analytics |
| **Text-to-SQL** | **Genie** (registered as agent tool) | Stretch — banks autonomous-data-task credit |
| **Tracing** | **MLflow 3 autolog** (`mlflow.langchain.autolog()`) | Stretch goal #1 — one line of setup |
| **Compute (offline)** | **Databricks Jobs** | Native, scheduled runs |
| **Deployment** | Local dev for app shell; Databricks for everything else | Per team decision |
| **Optional stretch** | Wrap LangGraph agent and serve via **Agent Bricks / Model Serving** | Banks max platform alignment |

## 9. How We Cover the Challenge Spec

### MVP requirements (CHALLENGE.md §2)

| Requirement | How |
|---|---|
| **Massive Unstructured Extraction** | Offline Step 3: Llama 3.3 reads description + capability prose, outputs structured JSON. Llama-on-Databricks-Model-Serving = direct IDP innovation alignment. |
| **Multi-Attribute Reasoning** | Online flow: intent extraction → SQL filter → hybrid retrieval (BM25 + dense + RRF) → LLM rerank → trust filter → MoA reasoning. Handles the canonical "rural Bihar appendectomy" query end-to-end with explicit attribute decomposition. |
| **Trust Scorer** | Multi-model jury (3 heterogeneous models) + 8 deterministic contradiction rules → 4-dim trust badge with sentence-level citations. |

### Stretch goals (CHALLENGE.md §3)

| Stretch | How |
|---|---|
| **Agentic Traceability** (row + step citations, MLflow 3) | MLflow 3 `langchain.autolog()` captures every node, tool, token. Citations carry `(facility_id, column, char_start, char_end)`. UI renders trace timeline + click-through citations. |
| **Self-Correction Loops** (Validator Agent) | Validator runs **after** MoA, with fresh context and the user's query in scope, on a different prompt template. Independent re-verification before answer ships. |
| **Dynamic Crisis Mapping** | `gold.region_capability_stats` aggregates verified capability count per district. Frontend choropleth toggles by capability, highlights deserts (e.g., "districts with >100k population, zero verified emergency surgery"). |

### Open research questions (CHALLENGE.md §4)

| Question | Our answer |
|---|---|
| **Confidence scoring with prediction intervals on incomplete data** | Multi-model jury agreement rate IS our confidence metric. Optional flourish: bootstrap confidence intervals on regional capability counts (sample-with-replacement over jury verdicts) — adds statistical rigor for the writeup. |

### Evaluation criteria (CHALLENGE.md §6)

| Weight | Criterion | How we score |
|---|---|---|
| 35% | Discovery & Verification | Verifiable Consensus — three independent judges, jury agreement rate as proxy ground truth. Validator agent as second pass. |
| 30% | IDP Innovation | Full Databricks-native data + serving stack: Delta + Unity Catalog + Foundation Model API (`gte-large-en` embeddings) + Model Serving (Llama 3.3 70B + Qwen3-Next 80B) + Genie + MLflow 3. Bronze/Silver/Gold ETL. Hybrid retrieval implemented in-process for full transparency. Optional Agent Bricks deployment. |
| 25% | Social Impact & Utility | NGO planner workflow: ask → cited recommendation → "why not others" → desert map → district drill-down. Concrete, actionable, auditable. |
| 10% | UX & Transparency | Live agent trace stream + jury panel + chain-of-thought thinking blocks + citation hover. Transparency *is* the UX. |

## 10. Risks & Open Items

### Verified on Databricks Free Edition (via Genie + manual checks)
- ✅ **Mosaic Vector Search**: API accessible but capped at **1 endpoint / 1 Vector Search unit**, **no Direct Vector Access**. **Decision: bypass.** Self-built hybrid retrieval (§5.4) avoids the cap and produces a more inspectable pipeline. SQL `array_cosine` confirmed available as a backup if ever needed.
- ✅ **Model Serving**: `databricks-meta-llama-3-3-70b-instruct` and `databricks-qwen3-next-80b-a3b-instruct` confirmed available. Rate limits not explicitly documented; 5 rapid test requests succeeded without throttling. **Decision: implement exponential-backoff retry for the 10k jury batch.**
- ✅ **Genie**: API accessible, space already created on workspace. Permissions governed by Unity Catalog.
- ✅ **AWS Bedrock egress**: `us-east-1` and `us-west-2` reachable from Databricks notebooks (returned expected 403 auth errors, proving connectivity). Store credentials in Databricks workspace secrets and call via `boto3` from notebooks.

### Deferred / nice-to-have
- Hand-labeled validation set (50-100 rows) for the reliability-curve slide. Skip for MVP, revisit if time.
- Embedding ensemble (two embedding models + RRF). Skip for MVP — single `gte-large-en` plus structured filters plus LLM rerank is enough on 10k rows.
- Cross-encoder reranker (BGE-reranker-v2-m3) as a stage between RRF and LLM rerank. Skip for MVP; LLM rerank alone is transparent and sufficient.
- Agent Bricks wrapping/serving as a deployment story. Stretch.
- Bootstrap confidence intervals on regional aggregates. Adds statistical rigor; do if writeup time permits.

### Known cost ceiling
- Offline jury (one-shot): ~$60-120, dominated by Sonnet 4.6 over 10k rows.
- Online query (per request): ~$0.05-0.15 depending on thinking budget. Aggregator dominates.
- Total demo budget: <$200 with comfortable margin. Well within hackathon credits.

---

## 11. Configuration & Environment Variables

Standardized variable names used across notebooks, FastAPI service, and frontend. Set in `.env` (local dev) and as Databricks workspace secrets (notebooks/jobs).

### AWS Bedrock (all Anthropic models)

| Variable | Value | Notes |
|---|---|---|
| `AWS_BEARER_TOKEN_BEDROCK` | `<bearer-token>` | Bedrock API key (new bearer-token format, not legacy AWS access keys) |
| `AWS_REGION` | `us-east-1` | Confirmed reachable from Databricks notebooks |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Cross-region inference profile for Sonnet 4.6 — used by aggregator, validator, tie-breaker, jury judge A |
| `BEDROCK_MODEL_ID_HAIKU` | `us.anthropic.claude-haiku-4-5` | Intent agent (fast, cheap) — confirm exact ID at impl time |

### Databricks

| Variable | Value | Notes |
|---|---|---|
| `DATABRICKS_HOST` | `https://<workspace>.cloud.databricks.com` | Workspace URL |
| `DATABRICKS_TOKEN` | `<personal-access-token>` | Workspace auth |
| `DATABRICKS_HTTP_PATH` | `/sql/1.0/warehouses/<id>` | SQL Warehouse endpoint for `databricks-sql-connector` |
| `DATABRICKS_LLAMA_ENDPOINT` | `databricks-meta-llama-3-3-70b-instruct` | Confirmed available on Free Edition |
| `DATABRICKS_QWEN_ENDPOINT` | `databricks-qwen3-next-80b-a3b-instruct` | Confirmed available on Free Edition |
| `DATABRICKS_EMBEDDING_ENDPOINT` | `databricks-gte-large-en` | Foundation Model API for `gte-large-en` |
| `DATABRICKS_GENIE_SPACE_ID` | `<space-id>` | Existing Genie space |

### MLflow (tracing)

| Variable | Value | Notes |
|---|---|---|
| `MLFLOW_TRACKING_URI` | `databricks` | Auto-uses Databricks workspace experiments |
| `MLFLOW_EXPERIMENT_NAME` | `/Users/<user>/sanjeevani-traces` | Workspace experiment path |

### Local app

| Variable | Value | Notes |
|---|---|---|
| `FASTAPI_PORT` | `8000` | Backend port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Frontend → backend |
| `UC_CATALOG` | `sanjeevani` | Unity Catalog namespace |
| `UC_SCHEMA_BRONZE` / `_SILVER` / `_GOLD` | `bronze` / `silver` / `gold` | Per-layer reads |

---

## 12. Build Phase Outline (preview)

Detailed plans will be authored next via superpowers planning. High-level shape:

1. **Data foundation** — Bronze/Silver layers, Unity Catalog setup, parsing, district/rural mapping (Census 2011)
2. **Offline LLM extraction** — Pipeline Step 3, Llama 3.3 over 10k rows on Databricks Model Serving
3. **Trust rules + jury** — Pipeline Steps 4-5; the Verifiable Consensus core (Sonnet 4.6 + Llama 3.3 + Qwen3-Next 80B)
4. **Embeddings + retrieval + aggregates** — Pipeline Steps 6-8; embeddings via Foundation Model API stored in Delta, in-process hybrid retrieval (BM25 + dense + RRF + LLM rerank), regional aggregates for crisis map
5. **Online agent service** — FastAPI + LangGraph, intent agent, hybrid retrieval, MoA subgraph, validator, MLflow tracing
6. **Frontend shell** — Next.js 16 scaffold (App Router, cacheComponents), map, facility drawer, basic chat
7. **Frontend chain-of-thought UX** — Custom SSE consumer, trace panel, jury widget, citation hover, crisis-map overlay
8. **Demo polish** — three hero queries scripted end-to-end, trace recordings, pitch deck
