"use client";

import { useEffect, useState } from "react";
import type { StreamEvent } from "@/lib/sse";

type ThinkingEvent = Extract<StreamEvent, { type: "thinking_delta" }>;

interface ThinkingNodeProps {
  event: ThinkingEvent;
  finished: boolean;
  /** Display label for the block; defaults to "Reasoning". */
  label?: string;
  /** Total ms over which the typewriter animates. Defaults proportional to text length. */
  durationMs?: number;
}

/**
 * Renders a Claude extended-thinking delta as a gray italic block with a
 * typewriter effect that lands on the full text. Once `finished`, the cursor
 * disappears and the full text is shown.
 */
export function ThinkingNode({
  event,
  finished,
  label = "Reasoning",
  durationMs,
}: ThinkingNodeProps) {
  const fullText = event.data.text;
  const [shown, setShown] = useState(finished ? fullText : "");

  useEffect(() => {
    if (finished) {
      setShown(fullText);
      return;
    }
    const dur = durationMs ?? Math.max(400, fullText.length * 12);
    const speed = Math.max(8, Math.floor(dur / fullText.length));
    let i = 0;
    const iv = setInterval(() => {
      i += 2;
      setShown(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(iv);
    }, speed);
    return () => clearInterval(iv);
  }, [fullText, finished, durationMs]);

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
          {shown}
          {!finished && shown.length < fullText.length && <span className="cursor" />}
        </div>
      </div>
    </div>
  );
}
