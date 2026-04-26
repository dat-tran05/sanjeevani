"use client";

import { useMemo } from "react";
import type { StreamEvent } from "@/lib/sse";
import type { TaggedEvent } from "@/lib/hooks/use-event-stream";
import { FUNNEL_STAGES, type StageTone } from "@/lib/demo/funnel-stages";

interface RetrievalFunnelProps {
  events: ReadonlyArray<TaggedEvent>;
}

const TONE_VAR: Record<StageTone, string> = {
  muted: "var(--fg-mute)",
  neutral: "var(--fg-3)",
  accent: "var(--gold)",
  green: "var(--green)",
};

/**
 * 7-stage retrieval funnel. Each row's bar shrinks by 12% per stage, mirroring
 * the prototype design (sanjeevani-chat.jsx: `Math.max(15, (1 - i * 0.12) * 100)`).
 * A stage stays at 0.25 opacity until its trigger predicate matches the current
 * event list, then snaps to 1.0 with a 600ms ease.
 */
export function RetrievalFunnel({ events }: RetrievalFunnelProps) {
  const litCount = useMemo(() => {
    const raw: ReadonlyArray<StreamEvent> = events.map((t) => t.ev);
    return FUNNEL_STAGES.filter((s) => s.trigger(raw)).length;
  }, [events]);

  return (
    <div className="funnel" aria-label="Retrieval funnel">
      <div className="funnel-head">Retrieval funnel</div>
      <div className="funnel-rows">
        {FUNNEL_STAGES.map((stage, i) => {
          const lit = i < litCount;
          const widthPct = Math.max(15, (1 - i * 0.12) * 100);
          const tone = TONE_VAR[stage.tone];
          return (
            <div
              key={stage.id}
              className={"funnel-row" + (lit ? " lit" : "")}
              style={{ ["--funnel-tone" as string]: tone }}
            >
              <div className="funnel-bar-wrap">
                <div
                  className="funnel-bar"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden
                />
              </div>
              <div className="funnel-meta">
                <span className="funnel-count">{lit ? stage.count : "—"}</span>
                <span className="funnel-label">{stage.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
