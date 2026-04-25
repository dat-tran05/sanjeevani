# Sanjeevani

> *Sanjeevani — the mythical life-saving herb. Find help, save lives.*

An agentic healthcare intelligence system for India's 10,000+ medical facilities. Built for **Hack-Nation × World Bank Global AI Hackathon 2026**, Challenge 03 (powered by Databricks).

The mission: turn a static, messy list of facility records into a **reasoning layer** that NGO planners and patients can use to find specialized care, audit hospital capability claims, and identify medical deserts across rural India.

## Repo layout

```
sanjeevani/
├── README.md
├── data/
│   └── india_healthcare_facilities.csv   # 10,053 facilities × 41 columns
└── docs/
    ├── CHALLENGE.md                      # Challenge brief (Markdown — easy read)
    └── challenge-brief.pdf               # Challenge brief (original PDF)
```

## The dataset

`data/india_healthcare_facilities.csv` — 10,053 rows, 41 columns. Mix of structured metadata (location, capacity, contacts) and unstructured free-text notes (specialties, procedures, equipment, capabilities, social signals).

Key columns:

- **Identity & contact:** `name`, `phone_numbers`, `email`, `websites`, `facebookLink`, `twitterLink`, `linkedinLink`, `instagramLink`
- **Location:** `address_line1..3`, `address_city`, `address_stateOrRegion`, `address_zipOrPostcode`, `latitude`, `longitude`
- **Type & affiliation:** `facilityTypeId`, `operatorTypeId`, `affiliationTypeIds`
- **Capability (free text / JSON-ish):** `description`, `specialties`, `procedure`, `equipment`, `capability`
- **Capacity:** `numberDoctors`, `capacity`
- **Trust & freshness signals:** `recency_of_page_update`, `distinct_social_media_presence_count`, `affiliated_staff_presence`, `custom_logo_presence`, `number_of_facts_about_the_organization`
- **Social engagement:** `post_metrics_*`, `engagement_metrics_n_followers`, `engagement_metrics_n_likes`, `engagement_metrics_n_engagements`

Many of the list-typed columns (e.g. `specialties`, `procedure`, `capability`) are stringified JSON arrays — parse before reasoning.

## What we're building (per the challenge)

**MVP**

1. **Unstructured extraction** over the 10k facility records.
2. **Multi-attribute reasoning** — natural-language queries like *"nearest facility in rural Bihar that can perform an emergency appendectomy with part-time doctors"*.
3. **Trust scorer** that flags contradictions (e.g. claims advanced surgery but lists no anesthesiologist).

**Stretch**

- Row- and step-level citation traceability (MLflow 3).
- Validator agent (self-correction loop).
- Dynamic crisis-mapping dashboard by PIN code.

Full brief: [`docs/CHALLENGE.md`](docs/CHALLENGE.md).

## Tech stack (intended)

- **Databricks Free Edition** — serverless compute + Unity Catalog
- **Agent Bricks** — foundation-model training & serving
- **Mosaic AI Vector Search** — retrieval over 10k rows
- **MLflow 3** — agent observability & tracing
- **Genie Code** — autonomous multi-step data tasks
