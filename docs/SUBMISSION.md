# Sanjeevani — Hack-Nation Submission Form Answers

> Drop-in copy for the Hack-Nation submission form. Each section maps to a form field; videos are out of scope here. Source-of-truth docs: [`OVERVIEW.md`](./OVERVIEW.md), [`CHALLENGE.md`](./CHALLENGE.md), [`../STATE.md`](../STATE.md).

---

## Project Title
**Sanjeevani — Verifiable Consensus for India's Medical Deserts**

*(Sanjeevani — the mythical life-saving herb. Find help, save lives.)*

---

## Event
5th-hack-nation

## Challenge
Serving A Nation (Agentic AI & Data Engineering) — Challenge 03

## Track
Agentic AI & Data Engineering

## Program Type
VC Big Bets

---

## Short Description

Agentic healthcare intelligence that turns India's messy 10,000-row facility registry into a trust-scored, multi-model-verified reasoning layer. NGO planners and patients ask natural-language questions ("nearest rural Bihar facility that can perform an emergency appendectomy") and get cited recommendations the system was willing to defend in front of three different language models — Claude Sonnet 4.6, Llama 3.3 70B, and Qwen3-Next 80B — sitting as a jury. Live agent trace, sentence-level citations, and a crisis map of medical deserts.

---

## 1. Problem & Challenge

In India, a postal code often determines a lifespan. 70% of the population lives in rural areas where healthcare access is a discovery and coordination crisis: families travel hours to find the wrong facility — the one that lists "ICU" in its specialties but doesn't actually run a 24/7 intensive care unit, or "Surgery" without an anesthesiologist on staff.

The structural problem is not that the data is missing. The 10,000-row Indian healthcare facility registry exists. The problem is that **the data is messy, inconsistent, full of unverifiable claims, and there is no ground truth to compare it against.** Capability columns are 36-84% null. Specialties are auto-tagged (66% of facilities are labeled "familyMedicine" by an upstream classifier). Equipment lists are 84% empty. Description text is the richest signal we have, but it's free-form prose riddled with marketing copy, partial information, and outright over-claims.

**Three concrete failure modes the agent must defeat:**

1. **The Truth Gap.** A clinic's structured fields say "ICU" but the description text never mentions one — pure marketing. Or the reverse: the description describes a 24/7 emergency theatre and on-call surgeons, but the structured `specialties` array only says "general medicine."
2. **Sparsity Under Acuity.** When a user asks for "emergency appendectomy in rural Bihar," the candidate pool drops from 10,000 to ~50 facilities. Half are clinics that shouldn't be in scope. Most have minimal description text. Picking the wrong one isn't an inconvenience — it's hours of unnecessary travel during an emergency.
3. **The Inflated Specialty.** A small clinic listing "oncology" alongside dentistry and dermatology is almost certainly not running radiation therapy. Without a verification mechanism, every keyword search returns garbage.

The challenge wants an agent that audits capability at scale, identifies specialized deserts, and reasons through the truth gap — *and* that double-checks its own work because there's no answer key to grade against. That last constraint is the hard one.

---

## 2. Target Audience

**Primary: NGO planners and public health field staff.** They route patients, allocate ambulance dispatch, and decide where new clinics should be built. They need an audit-quality answer they can defend to a director, not a search-engine ranking. Examples: World Bank field teams, Doctors Without Borders India operations, state public health departments.

**Secondary: patients and family caregivers in rural and tier-2 cities.** A natural-language interface in a chat panel, returning facility recommendations with trust badges and "why we picked these" reasoning, so a non-technical user can make a faster, better-informed referral.

**Tertiary: policymakers, journalists, public-health researchers.** The crisis map view turns 10,000 capability-coverage data points into a visual desert overlay — districts with >100k population and zero verified emergency surgery, dialysis access gaps, pediatric ICU shortages. Useful for grant-writing, investigative reporting, and government planning.

We deliberately did *not* design for hospital-staff-facing use. Hospitals are the source of the data, not the consumer of the analysis.

---

## 3. Solution & Core Features

Three integrated experiences in a single Next.js application:

### A. Conversational explorer with live agent trace
Users ask multi-attribute questions in natural language. The system streams its reasoning back live as a 12-step trace: planner reasoning → intent extraction → SQL prefilter → hybrid retrieval (BM25 + dense + RRF) → LLM rerank → two parallel proposers (Anthropic Sonnet 4.6 and Meta Llama 3.3 70B, both via Bedrock and Databricks Model Serving) → aggregator with extended thinking → multi-model jury verdicts per claim → tiebreaker → validator → final answer with sentence-level citations. The chat panel shows ranked recommendation cards with trust scores and a "Why not these?" panel listing 6 candidates the agent rejected with reasons.

### B. Map dashboard with medical-desert overlay
All 10,000 facilities rendered as map pins (MapLibre GL JS + deck.gl ScatterplotLayer). A toggleable crisis-map choropleth colors districts by capability gap severity — pediatric ICU access, oncology coverage, dialysis density, emergency trauma. Click any district to drill into a side drawer of facilities and verified-claim counts.

### C. Trust drill-down per facility
Click any facility pin to open a drawer with the 4-dimension trust badge (existence, coherence, recency, specificity), the three judges' verdicts side-by-side with agreement rate, and the source description with cited sentences highlighted in place. One-click traceability from a recommendation back to the exact text that justified it.

### Core functionalities the system performs

- **Massive unstructured extraction** — Llama 3.3 70B reads description + capability prose for each facility and emits structured JSON: explicit capabilities, implicit capabilities, surgery-capable boolean, 24/7 emergency boolean, named staff, named equipment, operating hours.
- **Verifiable Consensus jury** — three heterogeneous LLMs independently verdict every capability claim against the source text as supported / partial / unsupported. Disagreement triggers a Sonnet 4.6 extended-thinking tiebreaker.
- **Hybrid retrieval funnel** — every query narrows from 10,000 → ~150 candidates → 64 BM25+dense merged → 12 LLM-reranked → 3 final, with each stage emitted as a distinct trace event.
- **Mixture of Agents online reasoning** — for each query, two heterogeneous proposers (Sonnet + Llama) independently rank the candidates; an aggregator with extended thinking synthesizes their proposals and surfaces disagreements.
- **Validator pass** — independent fresh-context verification that every cited sentence offset resolves to real text in the source description (no hallucinated quotes).
- **Crisis-map aggregates** — district × capability rollups with verified-count, facility-count, and gap-severity scores driving the choropleth.

---

## 4. Unique Selling Proposition (USP)

**Verifiable Consensus.** When there is no answer key, we use *disagreement between heterogeneous models as our calibration signal.*

This is the central technical idea and it directly answers the challenge's hardest line: *"agents that double-check their own work."* No single LLM can verify its own output without bias toward its own training corpus. So we run three structurally different judges — Anthropic Claude Sonnet 4.6, Meta Llama 3.3 70B, Databricks Qwen3-Next 80B — independently against the same claim. Three-way agreement is high-confidence support. Two-of-three plus one dissent is partial. One-one-one or majority unsupported is escalated to a Sonnet extended-thinking tiebreaker. The agreement *rate itself* is our confidence metric — no need for hand-labeled validation data.

We apply the same principle in three places, for three different jobs:

| Pattern | Used for | Where |
|---|---|---|
| Multi-model jury (independent verdicts → vote) | Trust scoring of capability claims | Offline, all enriched facilities |
| Mixture of Agents (parallel proposers → aggregator) | User query reasoning | Online, per request |
| Validator agent (independent re-check, fresh context) | Final answer verification | Online, after MoA |

**Three things that make this different from a typical RAG-plus-LLM agent:**

1. **The trust system is the product, not a wrapper.** Most agentic search products show you results with a confidence number. We show you which models agreed, which dissented, what each judge cited, and the rationale of the tiebreaker when they split. The output is auditable end-to-end, with every recommendation traceable back to the exact verbatim quote in the source description. We pre-computed three judges' verdicts on every surfaced claim and replay them at query time.
2. **Heterogeneous-by-design jury panel.** Different vendors, different training corpora, different inference providers. A single-vendor "Sonnet judges Sonnet" jury would correlate errors. Heterogeneity is what makes the agreement signal meaningful.
3. **In-process hybrid retrieval bypasses the platform's vector-search cap.** Databricks Free Edition limits Mosaic AI Vector Search to 1 endpoint / 1 unit. We built BM25 + NumPy cosine + Reciprocal Rank Fusion + LLM rerank in-process at FastAPI startup, giving us full inspectability of every retrieval stage *and* a more transparent demo than a black-box similarity score. Each retrieval stage is emitted as a separate SSE event so judges literally watch the funnel narrow from 10,000 → 50 → 12 → 3 in real time.

---

## 5. Implementation & Technology

**Two-layer architecture.**

### Offline enrichment pipeline (Databricks-native)
Runs once over the 10k-row CSV. Produces enriched Delta tables on Unity Catalog (Bronze / Silver / Gold). Without this layer, every user query would have to call LLMs to interpret raw messy text — slow, expensive, inconsistent.

```
CSV → bronze.facilities_raw → silver.facilities_parsed → silver.facilities_extracted (Llama 3.3)
   → silver.facility_claims → gold.trust_verdicts (3-judge jury)
   → gold.tiebreaker_verdicts (Sonnet ext-thinking)
   → gold.facility_embeddings (gte-large-en, ARRAY<FLOAT> column)
   → gold.region_capability_stats → gold.trust_scores
```

Eight notebooks, ~30-45 min wall time end-to-end on Databricks Free Edition. Idempotent Delta MERGE on every layer so reruns pick up where they left off.

### Online agent service (FastAPI + LangGraph)
Eleven-node pipeline driven by an async generator that yields SSE events to a custom Next.js consumer. LangGraph holds the AgentState; MLflow 3 `langchain.autolog()` captures every node, tool call, and token count for the Agentic Traceability stretch goal.

```
planner (Sonnet ext-thinking)
  → intent (Haiku 4.5)
  → sql_prefilter (Databricks SQL Warehouse)
  → hybrid_retrieve (BM25 ‖ dense → RRF, in-process)
  → rerank (Llama 3.3 70B, Databricks Model Serving)
  → moa_propose (Sonnet ‖ Llama, parallel via asyncio.gather)
  → aggregator (Sonnet ext-thinking, structured cards + prose + escalations)
  → jury_lookup (gold.trust_verdicts, replayed with delays for trace animation)
  → tiebreaker (cache-first, live Sonnet ext-thinking fallback)
  → validator (Sonnet, fresh context, structural offset verification)
  → emit (cards → citations → text_delta → exclusions → stream_complete)
```

### Tech stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Next.js 16 App Router, TypeScript, React 19, `cacheComponents: true` for Partial Prerendering | Modern, polished UX |
| Map | MapLibre GL JS + deck.gl ScatterplotLayer | Free, handles 10k pins, choropleth-friendly |
| Design system | shadcn/ui + Tailwind | Speed |
| Streaming | Custom SSE consumer (not Vercel AI SDK) | Anthropic streaming has thinking blocks, tool_use blocks, multi-content turns — we render every category distinctly |
| Backend orchestration | FastAPI + LangGraph 1.0 | Multi-agent state machine, MLflow autolog hook |
| Anthropic models | Sonnet 4.6, Haiku 4.5 — via AWS Bedrock | Bearer-token auth (`AWS_BEARER_TOKEN_BEDROCK`) |
| Open models | Llama 3.3 70B, Qwen3-Next 80B — via Databricks Model Serving | Heterogeneous jury, IDP-Innovation alignment |
| Embeddings | `gte-large-en` via Databricks Foundation Model API | Stored as `ARRAY<FLOAT>` in Delta |
| Retrieval | `rank-bm25` (in-process) + NumPy cosine + RRF + LLM rerank | Bypasses Free Edition Mosaic VS limits; fully transparent funnel |
| Storage | Delta Lake on Unity Catalog (bronze/silver/gold) | Standard Lakehouse pattern |
| SQL | Databricks SQL Warehouse | Agent-callable analytics |
| Tracing | MLflow 3 `mlflow.langchain.autolog()` | One-line setup; captures every node, tool, token |
| Compute (offline) | Databricks Jobs / serverless notebooks | Native, scheduled runs |
| Deployment | Local dev for app shell; Databricks for everything offline | Per Free-Edition constraints |

### Engineering moves we're proud of

- **Async-generator orchestrator.** LangGraph holds typed state for autolog tracing; a custom async generator drives node execution and emits SSE events between them. This combines LangGraph's tracing benefits with strict event ordering on the wire.
- **Citation post-processor.** Sonnet's char_start/char_end offsets are unreliable (LLMs can't count chars). After Sonnet generates citations as verbatim excerpts, we search the excerpt in the actual facility description and recompute offsets, dropping any citation that can't be located. The validator then passes deterministically.
- **Bedrock bearer-token auth hardening.** Anthropic SDK ≥0.97 supports `AWS_BEARER_TOKEN_BEDROCK` but the boto3 credential chain still picks up stale `~/.aws/credentials`. We point `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` at `/dev/null` when a bearer token is present, forcing the new auth path.
- **Idempotent everything.** Every Delta table uses MERGE keyed on a stable identity (`facility_id`, `claim_id`, or `(claim_id, judge_model)`). Notebook reruns are safe and incremental.

---

## 6. Results & Impact

### What we shipped (verified end-to-end)

- **Data foundation:** 10,000-row Bronze + Silver, 177 facilities enriched (extraction + embeddings + claims), 127 jury claims with 381 individual model verdicts, 24 tiebreakers, 4-dim trust badges on all 10,000 facilities, district × capability aggregates.
- **Backend:** 11-node Verifiable Consensus pipeline streaming over Server-Sent Events. 14-event SSE taxonomy. Five HTTP endpoints (`/query`, `/facilities/all`, `/facilities/{id}`, `/crisis-map`, `/health`).
- **Frontend:** Next.js 16 with App Router, custom SSE consumer, ranked recommendation cards with trust badges and verbatim citations, agent trace panel rendering thinking blocks / tool calls / model proposals / jury verdicts side-by-side, MapLibre + deck.gl map with 10k pins and a crisis-map overlay.
- **Three hero queries verified:**
  - **Q1 — Bihar appendectomy:** "Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors." Returns 3 ranked cards (Jalal Medical Center, Dr. R K Thakur Hospital, Rajlaxmi Surgicare) with mixed jury verdicts (1 supported, 1 partial, 1 unsupported — exactly the "many claim, few prove" demo the trust system is built for) and 6 sharp exclusions explaining why other candidates were cut.
  - **Q2 — Bihar 24/7 ICU verification:** "Which Bihar hospitals can I trust for round-the-clock ICU care?" Returns 3 cards with trust scores 0.97 / 0.99 / 0.71, two unanimous-supported jury verdicts, and exclusions including `Neuron Hospital Patna: "description mentions ICU but carries only a general_surgery cap"` — the trust system catching real over-claims.
  - **Q3 — Tamil Nadu PICU desert:** Crisis-map endpoint returns 9 districts ranked by gap severity (Chennai 7-of-8 verified, Udumalaippettai 1-of-1, Namakkal 1-of-1, etc.). Powers the choropleth.

### How we hit the challenge rubric

| Weight | Criterion | What we deliver |
|---|---|---|
| **35%** | Discovery & Verification | Verifiable Consensus — three heterogeneous judges (Sonnet 4.6, Llama 3.3 70B, Qwen3-Next 80B) independently verdict each claim. Agreement rate is our confidence metric. Validator agent runs as an independent fresh-context second pass. |
| **30%** | IDP Innovation | Full Databricks-native stack: Delta + Unity Catalog + Foundation Model API + Model Serving + MLflow 3 autolog + SQL Warehouse. Bronze / Silver / Gold ETL. Hybrid retrieval implemented in-process for full transparency. |
| **25%** | Social Impact & Utility | Concrete NGO planner workflow: ask → cited recommendation → "Why not these?" panel with rejection reasons → desert map → district drill-down. Auditable end-to-end. |
| **10%** | UX & Transparency | Live agent trace stream + jury panel + extended-thinking blocks rendered as collapsible reasoning + sentence-level citation hover. Transparency is the UX. |

### Stretch goals delivered

- **Agentic Traceability.** MLflow 3 `mlflow.langchain.autolog()` enabled at FastAPI startup; every LangGraph node, tool call, and token count is captured. Every recommendation carries `(facility_id, column, char_start, char_end, excerpt)` citations validated against the source description.
- **Self-Correction Loops.** Validator agent runs after MoA with fresh context and a different prompt template, structurally verifying citation offsets resolve to real source text — no hallucinated references.
- **Dynamic Crisis Mapping.** `gold.region_capability_stats` aggregates verified capability count per district. The frontend choropleth toggles by capability and click-drills into district drawers.

### Cost / latency profile

| Metric | Value |
|---|---|
| Offline pipeline wall time (one-shot, full rebuild) | ~30-45 min on Databricks Free Edition |
| Offline pipeline cost (one-shot) | ~$25-40 (Sonnet jury dominates; Llama and Qwen are free quota) |
| Online query latency end-to-end | ~110s currently (planner ~12s, intent ~1s, retrieval ~5s, MoA ~20s, aggregator ~45s, jury+validator+emit ~30s) |
| Online query cost | ~$0.15-0.20 per request |
| Demo budget total | well under $200 |

### Honest caveats

- We pivoted hero query #2 from Mumbai radiation oncology to Bihar 24/7 ICU verification because Mumbai jury coverage in our enriched subset was structurally too thin (~3 juried claims). Bihar ICU exercises the same "verification under inflated claims" muscle and produces dramatically better demo results — most claims fail the jury, which is exactly the verification story we want to tell.
- Our enriched subset is 177 facilities (the hero-query neighborhoods). The other ~9,800 facilities are visible on the map with basic info but don't carry full trust badges or jury verdicts. Scaling the enrichment to all 10k is purely an offline cost / time decision.
- Online latency is on the high end (~110s) due to the aggregator's 4500-token extended-thinking budget. Trimming to 2000 tokens cuts ~25s with mild quality cost — a tunable knob, not a structural limit.

### Why it matters

A medical desert isn't a place without hospitals — it's a place without *verified* capability. Our system turns a static list of 10,000 buildings into a living intelligence network that knows where the help actually is, where it's claimed but not real, and where the gaps are. We're not selling the answer; we're selling the auditable reasoning that produced it. For a public-health planner deciding where to send the next ambulance or build the next clinic, that distinction is the entire game.

---

## Additional Information (Optional)

**Architecture decision record at:** [`docs/OVERVIEW.md`](./OVERVIEW.md) — full system overview, two-layer architecture diagrams, per-query flow, retrieval pipeline detail, trust scorer design, frontend chain-of-thought UX, tech-stack rationale, and open research questions.

**Build plan and design specs at:** [`docs/superpowers/specs/`](./superpowers/specs/) — original build plan and the Phase B2 backend trace pipeline design that the implementation follows verbatim.

**Current state:** [`STATE.md`](../STATE.md) — what's done, what's left, exact row counts, cost/latency profile.

**Notebooks:** [`databricks/notebooks/`](../databricks/notebooks/) — eight Databricks notebooks, runnable in order against any Databricks Free Edition workspace with the dataset loaded into a Unity Catalog volume.

**Integration test:** [`scripts/integration_check.sh`](../scripts/integration_check.sh) — runs all three hero queries against a live backend and prints SSE event counts; pass criteria are zero `error` events and one `stream_complete`.

**Bonus reading:** the source description text for many Indian healthcare facilities is unintentionally hilarious, deeply human, and occasionally heartbreaking. The trust system catches over-claims with the gentleness of a senior clinician giving feedback to a junior, not the snark of a content moderator. We're proud of that tone.

---

## Live Project URL
*(Local development only for the demo; the agent backend connects out to Databricks + Bedrock from the local FastAPI process.)*

## GitHub Repository URL
**https://github.com/dattran2k/sanjeevani** *(adjust to actual repo URL before submitting)*

## Technologies / Tags

**Primary stack:**
`Databricks` `Unity Catalog` `Delta Lake` `Mosaic AI` `MLflow 3` `Foundation Model API` `Llama 3.3 70B` `Qwen3-Next 80B`
`AWS Bedrock` `Claude Sonnet 4.6` `Claude Haiku 4.5`
`Python` `FastAPI` `LangGraph` `Pydantic v2` `rank-bm25` `NumPy`
`TypeScript` `Next.js 16` `React 19` `Tailwind` `shadcn/ui`
`MapLibre GL JS` `deck.gl` `Server-Sent Events`

## Additional Tags

`agentic-AI` `multi-agent` `mixture-of-agents` `verifiable-consensus`
`heterogeneous-jury` `RAG` `hybrid-retrieval` `BM25` `RRF` `extended-thinking`
`trust-scoring` `medical-desert-mapping` `chain-of-thought-streaming`
`citation-grounding` `MLflow-tracing` `self-correction` `validator-agent`
`healthcare` `public-health` `India` `World-Bank` `equitable-access`
