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
        /** Mono-text body shown under the step label — typically a SQL
         *  snippet, a numeric breakdown, or whatever rich detail the node
         *  produced. Free-form, multi-line allowed. */
        detail?: string;
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
 * The hook layer (`useEventStream`) merges live + baked demo data.
 *
 * Pass an AbortSignal to cancel the in-flight fetch (used to discard a
 * superseded run when the user changes the active query).
 */
export async function* streamQuery(
  query: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const resp = await fetch(`${apiUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSSEFrame(frame);
        if (ev) yield ev;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
