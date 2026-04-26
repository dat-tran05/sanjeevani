"use client";

import { useCallback, useRef, useState } from "react";
import { streamQuery, type StreamEvent, type StreamEventType } from "@/lib/sse";
import { DEMO_TRACE } from "@/lib/demo/trace";

/**
 * Tagged event — `__source: "live"` came from the backend SSE stream;
 * `__source: "demo"` was synthesized from the baked DEMO_TRACE because the
 * partner backend hasn't emitted that type yet.
 */
export interface TaggedEvent {
  __source: "live" | "demo";
  ev: StreamEvent;
}

export interface UseEventStreamOptions {
  /**
   * If after this long the live stream has emitted ZERO events, the backend
   * is treated as unreachable and the demo trace plays. Once any live event
   * arrives, this timeout no-ops — gap-filling is handled by the
   * post-stream-end check instead. Default 8000ms.
   */
  fallbackTimeoutMs?: number;
  /** When true (e.g. ?demo=1 query param), skip live fetch entirely. */
  forceDemo?: boolean;
  /** Demo replay speed multiplier; 1 = normal, 2 = 2x faster. */
  speed?: number;
}

export interface UseEventStreamReturn {
  events: TaggedEvent[];
  running: boolean;
  run: (query: string) => Promise<void>;
}

/**
 * Event types we synthesize from DEMO_TRACE if the live stream omits them.
 * These are the parts of the contract the partner backend hasn't shipped yet.
 */
const FALLBACK_REQUIRED_TYPES: ReadonlyArray<StreamEventType> = [
  "model_proposal",
  "consensus_resolved",
  "validator_pass",
  "recommendations_ready",
];

/**
 * Streams query results from the backend, merging live events with a baked
 * demo fallback for any required event types the backend hasn't emitted by
 * the time the live stream ends (or `fallbackTimeoutMs` elapses).
 *
 * In `forceDemo` mode (?demo=1) skips the live fetch entirely and replays
 * DEMO_TRACE on its native timeline scaled by `speed`.
 */
export function useEventStream(opts: UseEventStreamOptions = {}): UseEventStreamReturn {
  const { fallbackTimeoutMs = 8000, forceDemo = false, speed = 1 } = opts;
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [running, setRunning] = useState(false);
  const seenTypes = useRef<Set<StreamEventType>>(new Set());

  const run = useCallback(
    async (query: string) => {
      setRunning(true);
      setEvents([]);
      seenTypes.current = new Set();

      const append = (ev: StreamEvent, source: "live" | "demo") => {
        seenTypes.current.add(ev.type);
        setEvents((prev) => [...prev, { __source: source, ev }]);
      };

      const playDemoFallback = (skipSeen: boolean) => {
        const baseT = performance.now();
        for (const { ev, delay_ms } of DEMO_TRACE) {
          if (skipSeen && seenTypes.current.has(ev.type)) continue;
          const remaining = delay_ms / speed - (performance.now() - baseT);
          window.setTimeout(() => append(ev, "demo"), Math.max(0, remaining));
        }
      };

      if (forceDemo) {
        playDemoFallback(false);
        // running stays true while timeouts fire; flip after the last one.
        const total = DEMO_TRACE[DEMO_TRACE.length - 1]?.delay_ms ?? 0;
        window.setTimeout(() => setRunning(false), (total / speed) + 100);
        return;
      }

      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        // Only fire fallback if the backend is silent (zero live events
        // by `fallbackTimeoutMs`). Once any live event arrives, the timer
        // is a no-op — long-running streams (e.g. 110s pipeline) shouldn't
        // get demo events spliced in mid-flight.
        fallbackTimer = setTimeout(() => {
          if (seenTypes.current.size === 0) {
            playDemoFallback(true);
          }
        }, fallbackTimeoutMs);
        for await (const ev of streamQuery(query)) {
          append(ev, "live");
        }
        if (fallbackTimer) clearTimeout(fallbackTimer);
        // Live stream ended — synthesize any required types still missing.
        const missing = FALLBACK_REQUIRED_TYPES.filter((t) => !seenTypes.current.has(t));
        if (missing.length > 0) playDemoFallback(true);
      } catch (e) {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        append(
          {
            type: "error",
            data: { message: e instanceof Error ? e.message : "stream failed" },
          },
          "live"
        );
        playDemoFallback(true);
      } finally {
        setRunning(false);
      }
    },
    [fallbackTimeoutMs, forceDemo, speed]
  );

  return { events, running, run };
}
