/**
 * Baked SSE trace sequence for the Explorer's "rural Bihar appendectomy"
 * hero query. Used by useEventStream as the demo-mode fallback when the
 * partner backend hasn't yet emitted model_proposal / consensus_resolved /
 * validator_pass / recommendations_ready.
 *
 * Source: design's data.js SANJ.TRACE — translated from the design's
 * internal event shapes ({type:"thinking",label,text,dur,t}, etc.) into the
 * wire-format StreamEvent shape defined in lib/sse.ts.
 */
import type { StreamEvent } from "@/lib/sse";
import { FACILITIES, HERO_FACILITY_IDS } from "./facilities";
import { EXCLUSIONS } from "./exclusions";

export interface TimedEvent {
  ev: StreamEvent;
  /** Milliseconds from the start of the trace at which this event fires. */
  delay_ms: number;
}

const RECOMMENDATIONS_PAYLOAD: Extract<StreamEvent, { type: "recommendations_ready" }> = {
  type: "recommendations_ready",
  data: {
    facilities: HERO_FACILITY_IDS.map((id) => FACILITIES[id]).filter(
      (f): f is NonNullable<typeof f> => Boolean(f)
    ),
    excluded: EXCLUSIONS,
    pipeline_ms: 8400,
    candidates_considered: 12,
  },
};

export const DEMO_TRACE: TimedEvent[] = [
  // 1. Sonnet 4.6 reasons about how to approach the query.
  {
    delay_ms: 0,
    ev: {
      type: "thinking_delta",
      data: {
        text:
          "The user is asking about emergency appendectomy access in rural Bihar. " +
          "I'll need to (a) extract the structured intent — capability + region + urgency, " +
          "(b) prefilter the 10k facilities by state and proximity, " +
          "(c) apply hybrid retrieval, and (d) verify each top candidate's capability claim with the jury. " +
          "Sparsity is high in Bihar; I should weight description text over auto-derived specialties.",
      },
    },
  },

  // 2. Intent extraction agent step (Haiku 4.5).
  {
    delay_ms: 900,
    ev: {
      type: "agent_step_start",
      data: { step_id: "intent", name: "intent", label: "Intent extraction · Haiku 4.5" },
    },
  },
  {
    delay_ms: 1500,
    ev: {
      type: "agent_step_end",
      data: {
        step_id: "intent",
        name: "intent",
        summary:
          "Parsed intent: capability=emergency_surgery, region=Bihar, urgency=emergent, radius=80km",
        duration_ms: 600,
      },
    },
  },

  // 3. SQL prefilter tool call.
  {
    delay_ms: 1400,
    ev: {
      type: "tool_call",
      data: {
        tool: "sql_prefilter",
        input: { query: "delta.silver.facilities — state='BR' AND geo_within(...)" },
        output_summary:
          "→ 429 facilities matched\n→ runtime: 218ms\n→ index: state_geo_btree",
        duration_ms: 700,
      },
    },
  },

  // 4. Hybrid retrieval tool call.
  {
    delay_ms: 2000,
    ev: {
      type: "tool_call",
      data: {
        tool: "hybrid_retrieve (BM25 + dense + RRF)",
        input: { method: "RRF", k: 60 },
        output_summary:
          "BM25 top-32 + dense (bge-large-en) top-32 → RRF k=60\nrecall@64 = 0.92",
        duration_ms: 800,
      },
    },
  },

  // 5. Llama 3.3 rerank.
  {
    delay_ms: 2700,
    ev: {
      type: "agent_step_start",
      data: { step_id: "rerank", name: "rerank", label: "Rerank · Llama 3.3 70B" },
    },
  },
  {
    delay_ms: 3600,
    ev: {
      type: "agent_step_end",
      data: {
        step_id: "rerank",
        name: "rerank",
        summary:
          "Reranked 64 → top 12 by emergency-surgery relevance. Median rerank score Δ from BM25: +0.31. Top 3 candidates carry explicit emergency theatre citations.",
        duration_ms: 900,
      },
    },
  },

  // 6. MoA proposers (parallel — both fire ~simultaneously).
  {
    delay_ms: 3700,
    ev: {
      type: "model_proposal",
      data: {
        proposer_id: "A",
        vendor: "Anthropic · Sonnet 4.6",
        title: "Two proposers ran in parallel",
        text:
          "Recommends Sri Krishna (3/3 verified), Darbhanga (2/3 partial), Vaishali (escalate). Cites recency gap for Darbhanga.",
      },
    },
  },
  {
    delay_ms: 3760,
    ev: {
      type: "model_proposal",
      data: {
        proposer_id: "B",
        vendor: "Meta · Llama 3.3 70B",
        title: "Two proposers ran in parallel",
        text:
          "Recommends Sri Krishna and Darbhanga, but flags Vaishali — equipment list not specific enough to verify ICU support for surgical recovery.",
      },
    },
  },

  // 7. Aggregator synthesizes.
  {
    delay_ms: 4500,
    ev: {
      type: "agent_step_start",
      data: {
        step_id: "aggregate",
        name: "aggregate",
        label: "Aggregator · Sonnet 4.6 (extended thinking)",
      },
    },
  },
  {
    delay_ms: 5500,
    ev: {
      type: "agent_step_end",
      data: {
        step_id: "aggregate",
        name: "aggregate",
        summary:
          "Synthesized proposals into ranked list. Both proposers agree on top 2. Vaishali ranking divergence flagged for jury review.",
        duration_ms: 1000,
      },
    },
  },

  // 8. Sonnet thinks about the divergence.
  {
    delay_ms: 5300,
    ev: {
      type: "thinking_delta",
      data: {
        text:
          "Llama is right that Vaishali's equipment specificity is weak. " +
          "But the description does cite an operation theatre and around-the-clock operation. " +
          "I'll mark it as 'partial — escalate' rather than removing it. " +
          "The planner should see it with caveats.",
      },
    },
  },

  // 9. Jury verdict 1 — Sri Krishna 3/3 supported.
  {
    delay_ms: 6200,
    ev: {
      type: "consensus_resolved",
      data: {
        claim: "claim_id: cap_es_F-MZN-0214",
        title: "Sri Krishna runs 24/7 emergency surgery",
        verdict: "supported",
        agreement: 3,
        dissent: false,
        judges: [
          {
            name: "Claude Sonnet 4.6",
            vendor: "Anthropic · Bedrock",
            verdict: "supported",
            confidence: 0.94,
            excerpt:
              "operates a 24-hour emergency theatre with on-call general surgery, anesthesia, and post-op recovery",
          },
          {
            name: "Llama 3.3 70B",
            vendor: "Meta · Databricks",
            verdict: "supported",
            confidence: 0.88,
            excerpt: "lists laparoscopic appendectomy among its routine procedures",
          },
          {
            name: "Qwen 3 80B",
            vendor: "Databricks · DBRX",
            verdict: "supported",
            confidence: 0.91,
            excerpt: "six-bed surgical ICU",
          },
        ],
      },
    },
  },

  // 10. Jury verdict 2 — Vaishali 1/3 with dissent + tiebreaker.
  {
    delay_ms: 7000,
    ev: {
      type: "consensus_resolved",
      data: {
        claim: "claim_id: cap_es_F-PAT-0331",
        title: "Vaishali handles emergency abdominal surgery",
        verdict: "partial",
        agreement: 1,
        dissent: true,
        judges: [
          {
            name: "Claude Sonnet 4.6",
            vendor: "Anthropic · Bedrock",
            verdict: "partial",
            confidence: 0.62,
            excerpt: "referral facility for abdominal surgery, trauma stabilization",
          },
          {
            name: "Llama 3.3 70B",
            vendor: "Meta · Databricks",
            verdict: "unsupported",
            confidence: 0.71,
            excerpt: "operation theatre and ICU — but no specifics on emergency capability",
            dissent_note:
              "Description is general. 'Operation theatre' alone doesn't establish 24-hour surgical capability or appendectomy procedure.",
          },
          {
            name: "Qwen 3 80B",
            vendor: "Databricks · DBRX",
            verdict: "supported",
            confidence: 0.66,
            excerpt: "Operates around the clock per posted notice",
          },
        ],
        tiebreaker: {
          model: "Sonnet 4.6 · extended thinking",
          verdict: "partial",
          reasoning:
            "All three judges identify a real signal but disagree on its strength. The description supports presence of surgical capacity but is not specific enough to guarantee emergent appendectomy. Final verdict: PARTIAL — surface to planner with caveats.",
        },
      },
    },
  },

  // 11. Validator agent.
  {
    delay_ms: 7800,
    ev: {
      type: "validator_pass",
      data: {
        title: "Validator · Sonnet 4.6 (fresh context)",
        body:
          "All citation offsets verified against silver.facilities.description text. No hallucinated references. Output approved.",
        passed: true,
      },
    },
  },

  // 12. Final structured payload — what RecommendationCard + WhyNotThese render.
  {
    delay_ms: 8400,
    ev: RECOMMENDATIONS_PAYLOAD,
  },
];
