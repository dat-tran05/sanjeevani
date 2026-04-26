/**
 * Sanjeevani — SSE event contract.
 *
 * This module is the source of truth for the wire format between the FastAPI
 * backend and the Next.js frontend. The discriminated union below tells you
 * exactly what JSON shape each event must produce; the parser is the only
 * frontend code that reads raw SSE frames.
 *
 * Partner backend reference: docs/sse-event-contract.md (mirrors this file).
 */
import type { RecommendedFacility, ExcludedFacility, Verdict } from "@/lib/types";

export type StreamEvent =
  | { type: "thinking_delta"; data: { text: string } }
  | {
      type: "agent_step_start";
      data: { step_id: string; name: string; label: string };
    }
  | {
      type: "agent_step_end";
      data: {
        step_id: string;
        name: string;
        summary?: string;
        duration_ms?: number;
      };
    }
  | {
      type: "tool_call";
      data: {
        tool: string;
        input?: Record<string, unknown>;
        output_summary?: string;
        duration_ms?: number;
      };
    }
  | {
      type: "model_proposal";
      data: { proposer_id: "A" | "B"; vendor: string; title: string; text: string };
    }
  | { type: "consensus_resolved"; data: ConsensusResolvedData }
  | { type: "validator_pass"; data: { title: string; body: string; passed: boolean } }
  | { type: "text_delta"; data: { text: string } }
  | {
      type: "citation";
      data: {
        citation_id: string;
        facility_id: string;
        column: string;
        char_start: number;
        char_end: number;
        excerpt: string;
      };
    }
  | {
      type: "recommendations_ready";
      data: {
        facilities: RecommendedFacility[];
        excluded: ExcludedFacility[];
        pipeline_ms: number;
        candidates_considered: number;
      };
    }
  | { type: "error"; data: { message: string } };

export interface ConsensusResolvedData {
  /** The claim being verdicted, e.g. "performs emergency appendectomy". */
  claim: string;
  /** Optional display title, e.g. "Emergency surgery — Sadar Hospital". */
  title?: string;
  verdict: Verdict;
  /** Number of judges agreeing with the consensus verdict (0–3). */
  agreement: 0 | 1 | 2 | 3;
  dissent: boolean;
  judges: Array<{
    /** Display name, e.g. "Claude Sonnet 4.6". */
    name: string;
    /** Vendor + provider, e.g. "Anthropic · Bedrock". */
    vendor: string;
    verdict: Verdict;
    /** 0–1 confidence score. */
    confidence: number;
    /** Judge's quoted evidence sentence. */
    excerpt: string;
    /** Set on dissenting judges only. */
    dissent_note?: string;
  }>;
  /** Present only when all three judges initially disagreed. */
  tiebreaker?: { model: string; verdict: Verdict; reasoning: string };
}

export type StreamEventType = StreamEvent["type"];

/**
 * Event types the existing backend (`backend/app/streaming/sse.py`) already
 * emits. Used by `useEventStream` to decide which event types it must
 * synthesize from baked demo data when the live stream omits them.
 */
const LIVE_ONLY_TYPES: ReadonlySet<StreamEventType> = new Set<StreamEventType>([
  "thinking_delta",
  "agent_step_start",
  "agent_step_end",
  "tool_call",
  "text_delta",
  "citation",
  "error",
]);

export function isLiveOnlyEvent(t: StreamEventType): boolean {
  return LIVE_ONLY_TYPES.has(t);
}

/** Parses a single SSE frame ("data: {...}") into a typed event, or null. */
export function parseSSEFrame(frame: string): StreamEvent | null {
  if (!frame.startsWith("data: ")) return null;
  const json = frame.slice(6);
  try {
    return JSON.parse(json) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * POST a query to the backend and yield SSE events as they arrive.
 * Delegates to the adapter in `lib/sse-adapter.ts`, which translates the
 * backend's 14-event taxonomy (jury_verdict, ranked_card, exclusion, …)
 * into the discriminated union the components consume (consensus_resolved,
 * recommendations_ready, …).
 */
export async function* streamQuery(query: string): AsyncGenerator<StreamEvent> {
  const { streamFromBackend } = await import("@/lib/sse-adapter");
  yield* streamFromBackend(query);
}
