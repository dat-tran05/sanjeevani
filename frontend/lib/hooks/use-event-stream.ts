"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
   * If the live stream finishes (or `fallbackTimeoutMs` elapse) without any
   * of the four fallback-required events, demo-trace events for the missing
   * types are appended.
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
 *
 * Race-safe: each `run()` increments a generation counter; appends from
 * a previous run (timer callbacks, in-flight fetch reads) are dropped when
 * their generation no longer matches the active one. Strict-Mode double-mount
 * and rapid `run()` calls cannot interleave events anymore.
 */
export function useEventStream(opts: UseEventStreamOptions = {}): UseEventStreamReturn {
  const { fallbackTimeoutMs = 8000, forceDemo = false, speed = 1 } = opts;
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [running, setRunning] = useState(false);
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const seenTypesRef = useRef<Set<StreamEventType>>(new Set());

  // Cleanup on unmount: abort in-flight stream so the catch path doesn't
  // append stale events to a torn-down React tree.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      genRef.current += 1;
    };
  }, []);

  const run = useCallback(
    async (query: string) => {
      // Bump generation; abort any prior fetch.
      genRef.current += 1;
      const myGen = genRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      seenTypesRef.current = new Set();
      setEvents([]);
      setRunning(true);

      const append = (ev: StreamEvent, source: "live" | "demo") => {
        if (genRef.current !== myGen) return; // stale
        seenTypesRef.current.add(ev.type);
        setEvents((prev) => [...prev, { __source: source, ev }]);
      };

      const playDemoFallback = (skipSeen: boolean) => {
        const baseT = performance.now();
        for (const { ev, delay_ms } of DEMO_TRACE) {
          if (skipSeen && seenTypesRef.current.has(ev.type)) continue;
          const remaining = delay_ms / speed - (performance.now() - baseT);
          window.setTimeout(() => append(ev, "demo"), Math.max(0, remaining));
        }
      };

      if (forceDemo) {
        playDemoFallback(false);
        const total = DEMO_TRACE[DEMO_TRACE.length - 1]?.delay_ms ?? 0;
        window.setTimeout(() => {
          if (genRef.current === myGen) setRunning(false);
        }, total / speed + 100);
        return;
      }

      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        fallbackTimer = setTimeout(() => {
          if (genRef.current === myGen) playDemoFallback(true);
        }, fallbackTimeoutMs);

        for await (const ev of streamQuery(query, controller.signal)) {
          if (genRef.current !== myGen) break; // stale, abort consumption
          append(ev, "live");
        }

        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (genRef.current !== myGen) return;

        const missing = FALLBACK_REQUIRED_TYPES.filter(
          (t) => !seenTypesRef.current.has(t),
        );
        if (missing.length > 0) playDemoFallback(true);
      } catch (e) {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (genRef.current !== myGen) return; // ignore aborted-by-newer-run
        if (e instanceof DOMException && e.name === "AbortError") return;
        append(
          {
            type: "error",
            data: { message: e instanceof Error ? e.message : "stream failed" },
          },
          "live",
        );
        playDemoFallback(true);
      } finally {
        if (genRef.current === myGen) setRunning(false);
      }
    },
    [fallbackTimeoutMs, forceDemo, speed],
  );

  return { events, running, run };
}
