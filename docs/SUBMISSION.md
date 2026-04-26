# Sanjeevani — Hack-Nation Submission Form Answers

> Drop-in copy for the Hack-Nation submission form. Source-of-truth docs: [`OVERVIEW.md`](./OVERVIEW.md), [`CHALLENGE.md`](./CHALLENGE.md), [`../STATE.md`](../STATE.md).

---

## Project Title

Sanjeevani — Verifiable Consensus for India's Medical Deserts

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

Sanjeevani is an agentic healthcare intelligence layer over India's 10,053-row facility registry. NGO planners and patients ask natural-language questions ("nearest rural Bihar facility that can perform an emergency appendectomy") and get cited recommendations the system was willing to defend in front of three independent language models, sitting as a heterogeneous jury. Built on Databricks (Genie, Foundation Model API, Model Serving, MLflow 3) with LangGraph orchestration, custom SSE streaming, and a Next.js 16 frontend that renders the live agent trace, sentence-level citations, and a crisis map of medical deserts.

## Problem & Challenge

In India, a postal code often determines a lifespan. 70% of the population lives in rural areas where healthcare access is a discovery and coordination crisis — patients travel hours only to find a facility lacks the specific oxygen supply, neonatal bed, or specialist they urgently need. The 10,000-row Indian facility registry exists, but the agent has to do three hard things over it: audit capability at scale (does this hospital actually run a functional ICU or does it just list one?), identify specialized deserts for high-acuity needs like oncology, dialysis, and emergency trauma, and navigate the truth gap when free-form facility descriptions claim capabilities that don't match the reported equipment. The challenge has no answer key to grade against, so the agent has to double-check its own work. That last constraint is the hard one.

## Target Audience

Primary: NGO planners and public-health field staff (World Bank field teams, Doctors Without Borders India, state health departments) who route patients, dispatch ambulances, and decide where to build the next clinic — and need an audit-quality answer they can defend to a director. Secondary: patients and family caregivers in rural and tier-2 cities who need a fast, trustworthy referral. Tertiary: policymakers, journalists, and public-health researchers using the desert overlay for grant-writing, investigative work, and government planning.

## Solution & Core Features

Three integrated experiences in a single Next.js application. (1) A conversational explorer with a live agent trace — users ask multi-attribute questions and the system streams its 12-step reasoning back: planner, intent extraction, SQL prefilter, hybrid retrieval (BM25 + dense + RRF), LLM rerank, two parallel proposers, aggregator with extended thinking, multi-model jury verdicts per claim, tiebreaker, validator, and final answer with sentence-level citations. (2) A map dashboard with all 10k facilities rendered as MapLibre + deck.gl pins and a toggleable crisis-map choropleth coloring districts by capability gap severity. (3) A trust drill-down per facility with a 4-dimension trust badge (existence, coherence, recency, specificity), the three judges' verdicts side-by-side, and the source description with cited sentences highlighted in place. Behind those three surfaces is an offline Databricks pipeline that does the heavy lifting once: Llama 3.3 70B extracts capabilities from each facility's free-text description, three heterogeneous judges verdict every claim, and district × capability rollups feed the choropleth — so online queries only pay for the live reasoning stages above.

## Unique Selling Proposition

Verifiable Consensus. When there is no answer key, we use disagreement between heterogeneous models as our calibration signal — three structurally different judges (Sonnet 4.6, Llama 3.3 70B, Qwen3-Next 80B) independently verdict every claim, and the agreement rate itself is the confidence metric, no hand-labeled validation data required. We apply the same principle — grounded in established LLM-ensemble research — in three places: a multi-model jury for offline trust scoring, Mixture-of-Agents (parallel proposers → aggregator) for online reasoning, and a fresh-context validator pass. The trust system is the product, not a wrapper: every recommendation carries verbatim citations, jury panels show which models agreed and dissented, and each retrieval stage streams as a distinct SSE event.

## Implementation & Technology

Two-layer architecture. An offline Databricks pipeline (Bronze → Silver → Gold across eight notebooks) does the heavy lifting once: Llama 3.3 70B extraction, three-judge jury with Sonnet 4.6 extended-thinking tiebreakers, gte-large-en embeddings, and district × capability rollups. The online service is FastAPI + LangGraph 1.0 streaming eleven nodes over a custom SSE consumer to a Next.js 16 App Router frontend with Partial Prerendering. Anthropic models call AWS Bedrock; Llama 3.3 70B, Qwen3-Next 80B, and embeddings run on Databricks Model Serving. Retrieval is in-process (BM25 + NumPy cosine + RRF + LLM rerank) so every score and rank is inspectable in the trace UI. Genie is wired as a callable tool for free-form analytical follow-ups; MLflow 3 `mlflow.langchain.autolog()` captures every node, tool call, and token count.

## Results & Impact

Verified end-to-end across three hero queries: Bihar appendectomy (three ranked cards with mixed jury verdicts and six sharp exclusions explaining why other candidates were cut), Bihar 24/7 ICU verification (catches real over-claims — e.g. "Neuron Hospital Patna: description mentions ICU but carries only a general_surgery cap"), and Tamil Nadu PICU desert (nine districts ranked by gap severity, powering the choropleth). Data foundation: 10,053-row Bronze + Silver, 177 enriched facilities, 127 jury claims with 381 individual model verdicts, 24 tiebreakers, and 4-dimension trust badges across all 10,053 rows. The 11-node pipeline streams a 14-event SSE taxonomy at ~110 s end-to-end and ~$0.15–0.20 per query; offline pipeline cost ~$25–40 one-time. All three stretch goals delivered: Agentic Traceability via MLflow 3 autolog, Self-Correction via the validator agent, and Dynamic Crisis Mapping via the toggleable district choropleth.

## Additional Information

Verifiable Consensus is an application of established LLM-ensemble and self-verification literature — Verga et al. 2024 (Panel of LLM Evaluators), Wang et al. 2024 (Mixture-of-Agents), Du et al. 2023 (Multi-Agent Debate), Bai et al. 2022 (Constitutional AI / RLAIF), and Cormack et al. 2009 (Reciprocal Rank Fusion) — combined around a clear product story for a domain with no answer key.

## Live Project URL

Local development only for the demo; the agent backend connects out to Databricks + Bedrock from the local FastAPI process.

## GitHub Repository URL

https://github.com/dattran2k/sanjeevani

## Technologies / Tags

Databricks, Unity Catalog, Delta Lake, Mosaic AI, MLflow 3, Foundation Model API, Databricks Genie, Databricks Model Serving, Llama 3.3 70B, Qwen3-Next 80B, AWS Bedrock, Claude Sonnet 4.6, Claude Haiku 4.5, Python, FastAPI, LangGraph, Pydantic v2, rank-bm25, NumPy, TypeScript, Next.js 16, React 19, Tailwind, shadcn/ui, MapLibre GL JS, deck.gl, Server-Sent Events

## Additional Tags

agentic-AI, multi-agent, mixture-of-agents, verifiable-consensus, heterogeneous-jury, panel-of-LLM-evaluators, LLM-as-a-judge, RAG, hybrid-retrieval, BM25, RRF, extended-thinking, trust-scoring, medical-desert-mapping, chain-of-thought-streaming, citation-grounding, MLflow-tracing, self-correction, validator-agent, text-to-SQL, Genie, healthcare, public-health, India, World-Bank, equitable-access
