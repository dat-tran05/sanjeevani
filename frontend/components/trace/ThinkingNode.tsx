"use client";

import { useState } from "react";
import type { StreamEvent } from "@/lib/sse";

type ThinkingEvent = Extract<StreamEvent, { type: "thinking_delta" }>;

interface ThinkingNodeProps {
  /** Single event (legacy) or list of consecutive deltas to concat. */
  event?: ThinkingEvent;
  events?: ThinkingEvent[];
  finished: boolean;
  /** Display label for the block; defaults to "Reasoning". */
  label?: string;
  /** Total ms over which the typewriter animates. Defaults proportional to text length. */
  durationMs?: number;
}

/**
 * Renders a Claude extended-thinking delta as a gray italic block with a
 * typewriter effect. When `finished`, the cursor disappears and the full
 * text is shown directly (no animation).
 *
 * Accepts either a single `event` or a list of consecutive `events` —
 * TraceStream groups consecutive thinking_delta events into one node so
 * the live stream's many small chunks coalesce into one reasoning block.
 */
export function ThinkingNode({
  event,
  events,
  finished,
  label = "Reasoning",
  durationMs,
}: ThinkingNodeProps) {
  const fullText = events
    ? events.map((e) => e.data.text).join("")
    : event?.data.text ?? "";
  // Backend chunks thinking_delta into many tiny events. Each new chunk
  // grows fullText, which would otherwise restart the typewriter from 0.
  // Instead we render the full text immediately as it streams in — the
  // backend's chunking IS the streaming animation.
  const shown = fullText;
  const showCursor = !finished;

  // Long reasoning blocks default to collapsed once the stream is done so
  // the rest of the trace stays scannable. Live (un-finished) blocks always
  // show fully — the typewriter is the visual point.
  const COLLAPSE_THRESHOLD = 400;
  const isLong = fullText.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const collapsed = finished && isLong && !expanded;
  const display = collapsed ? shown.slice(0, COLLAPSE_THRESHOLD) + "…" : shown;

  return (
    <div className="trace-event">
      <div className="node done" />
      <div className="thinking">
        <div className="label">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1" />
            <path d="M5.5 3v3l2 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          {label}
        </div>
        <div className="text">
          {display}
          {showCursor && <span className="cursor" />}
        </div>
        {finished && isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: "none",
              border: "none",
              padding: "6px 0 0",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--gold)",
              cursor: "pointer",
            }}
          >
            {expanded ? "↑ Collapse" : "↓ Show all"}
          </button>
        )}
      </div>
    </div>
  );
}
