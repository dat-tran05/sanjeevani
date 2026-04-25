# Serving A Nation — Challenge 03

**Building Agentic Healthcare Maps for 1.4 Billion Lives**

Hack-Nation × World Bank Youth Summit · Global AI Hackathon 2026
In collaboration with MIT Club of Northern California and MIT Club of Germany.
Powered by **Databricks — Data Intelligence Platform**.

> Source: [`challenge-brief.pdf`](./challenge-brief.pdf) (this Markdown is a transcription of the official PDF).

---

## 1. Motivation / Goal

**Motivation:** In India, a postal code often determines a lifespan. While the nation boasts world-class medical hubs, 70% of the population lives in rural areas where healthcare access is a fragmented puzzle. The issue is not just a lack of hospitals — it is a discovery and coordination crisis. Patients often travel hours only to find a facility lacks the specific oxygen supply, neonatal bed, or specialist they urgently need.

With a dataset of 10,000+ medical facilities, we are moving beyond simple data entry. We are building **the Reasoning Layer for Indian healthcare**.

**Ambitious Goal:** Build an **Agentic Healthcare Intelligence System** that can navigate 10,000 messy, unstructured facility reports to find hidden life-saving capabilities. Reduce the *Discovery-to-Care* time so no family is left guessing where to find help.

The agent must be able to:

- **Audit Capability at Scale:** Sift through thousands of unstructured notes to verify if a hospital actually has a functional ICU or just lists one.
- **Identify Specialized Deserts:** Locate regional gaps for high-acuity needs like Oncology, Dialysis, or Emergency Trauma.
- **Navigate the Truth Gap:** Reason through non-standardized facility descriptions and flag contradictions where claims do not match reported equipment.

## 2. Core Features (MVP)

1. **Massive Unstructured Extraction:** Use the Databricks Data Intelligence Platform to process free-form text from 10k Indian facility records — including equipment logs, 24/7 availability claims, and staff specialties.
2. **Multi-Attribute Reasoning:** Move beyond keyword search. The agent must answer complex queries like: *"Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors."*
3. **The Trust Scorer:** Since there is no answer key, build a logic step that flags suspicious or incomplete data — e.g. a facility claiming Advanced Surgery but listing no Anesthesiologist.

## 3. Stretch Goals

1. **Agentic Traceability:** Provide row-level and step-level citations. If the agent recommends a facility, it must show the exact sentence in the medical report that justifies the Trust Score. *Hint: use MLflow 3 Tracing to visualize the agent's thought process.*
2. **Self-Correction Loops:** Implement a Validator Agent that cross-references extracted data against known medical standards, ensuring the primary agent is not hallucinating.
3. **Dynamic Crisis Mapping:** A visual dashboard overlaying the agent's findings onto a map of India. Highlight the highest-risk medical deserts by PIN code.

## 4. Areas of Research (open questions)

1. **Key Questions:** The Databricks for Good team is working on these; if you can robustly solve "could have" or "won't have" items, please share.
2. **Confidence Scoring:** Real-world data is messy and the dataset is incomplete with errors. How to account for this when framing conclusions? Can statistics-based methods produce prediction intervals around conclusions?

## 5. Hints and Resources

**Environment:** Optimized for **Databricks Free Edition**. Use the provided serverless compute and the built-in Unity Catalog for data governance.

**Primary tech stack**

- **Data Intelligence:** Agent Bricks for Foundation Model Training and Serving.
- **Agentic Engineering:** Genie Code for autonomous, multi-step data tasks.
- **Observability:** MLflow 3 for agent observability and trace cost tracking.
- **Vector DB:** Mosaic AI Vector Search for high-speed retrieval across 10k rows.

**Datasets**

- **The India 10k Dataset:** 10,000 medical facilities across India with structured metadata and deep unstructured notes. See [`../data/india_healthcare_facilities.csv`](../data/india_healthcare_facilities.csv).
- **Virtue Foundation Schema:** Standardized pydantic models to help structure extraction.

## 6. Evaluation Criteria

| Weight | Criterion | What's evaluated |
| --- | --- | --- |
| 35% | **Discovery and Verification** | How reliably the agent extracts data from 10k rows. Since there is no ground truth, agents that double-check their own work are valued. |
| 30% | **IDP Innovation** | How well the solution synthesizes information from messy, free-form Indian facility notes. |
| 25% | **Social Impact and Utility** | Does the tool effectively identify medical deserts and provide actionable insights for NGO planners? |
| 10% | **UX and Transparency** | Is the interface intuitive? Does it show its Chain of Thought so a human can trust the output? |

## 7. Why It Matters

In a country of 1.4 billion people, *near enough* is not good enough. By building this agentic layer on Databricks, you are creating a blueprint for **Equitable Healthcare** — turning a static list of 10,000 buildings into a living intelligence network that knows where the help is and where it needs to go.
