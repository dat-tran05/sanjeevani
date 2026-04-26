"use client";

import { useEffect, useMemo, useRef } from "react";
import type { StreamEvent } from "@/lib/sse";
import type { TaggedEvent } from "@/lib/hooks/use-event-stream";
import { TraceEvent } from "./TraceEvent";
import { AgentStepNode } from "./AgentStepNode";
import { ProposalsNode } from "./ProposalsNode";
import { RetrievalFunnel } from "./RetrievalFunnel";

type ModelProposalEv = Extract<StreamEvent, { type: "model_proposal" }>;
type AgentStepStartEv = Extract<StreamEvent, { type: "agent_step_start" }>;
type AgentStepEndEv = Extract<StreamEvent, { type: "agent_step_end" }>;

type TraceItem =
  | { kind: "single"; ev: StreamEvent; finished: boolean; key: string; demo: boolean }
  | { kind: "agent_step"; start: AgentStepStartEv; end: AgentStepEndEv | null; key: string; demo: boolean }
  | { kind: "proposals"; events: ModelProposalEv[]; key: string; demo: boolean };

/**
 * Collapses the raw tagged-event list into render items:
 *   - agent_step_start paired with its matching agent_step_end by step_id
 *     (single AgentStepNode that flips spinner→checkmark when end arrives);
 *   - consecutive model_proposal events grouped into one ProposalsNode
 *     (so the side-by-side A/B layout renders once both have arrived);
 *   - text_delta / citation skipped (rendered in the main column).
 */
function buildItems(events: TaggedEvent[]): TraceItem[] {
  const items: TraceItem[] = [];
  for (let i = 0; i < events.length; i++) {
    const tagged = events[i]!;
    const ev = tagged.ev;
    const demo = tagged.__source === "demo";

    if (ev.type === "agent_step_start") {
      const stepId = ev.data.step_id;
      const matchEnd = events
        .slice(i + 1)
        .find(
          (t): t is TaggedEvent & { ev: AgentStepEndEv } =>
            t.ev.type === "agent_step_end" && t.ev.data.step_id === stepId
        );
      items.push({
        kind: "agent_step",
        start: ev,
        end: matchEnd?.ev ?? null,
        key: `step-${stepId}`,
        demo,
      });
      continue;
    }
    if (ev.type === "agent_step_end") continue;

    if (ev.type === "model_proposal") {
      const group: ModelProposalEv[] = [ev];
      let j = i + 1;
      while (j < events.length && events[j]!.ev.type === "model_proposal") {
        group.push(events[j]!.ev as ModelProposalEv);
        j++;
      }
      items.push({ kind: "proposals", events: group, key: `props-${i}`, demo });
      i = j - 1;
      continue;
    }

    if (ev.type === "text_delta" || ev.type === "citation") continue;

    items.push({
      kind: "single",
      ev,
      finished: i < events.length - 1,
      key: `${ev.type}-${i}`,
      demo,
    });
  }
  return items;
}

interface TraceStreamProps {
  events: TaggedEvent[];
  /** Total expected events (for the SSE n/total meta line). */
  totalExpected?: number;
}

export function TraceStream({ events, totalExpected }: TraceStreamProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildItems(events), [events]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [items.length]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="trace-panel">
      <div className="trace-head">
        <h3>
          <span className="live-dot" />
          Agent Trace
        </h3>
        <span className="meta">
          SSE · {events.length}
          {totalExpected ? `/${totalExpected}` : ""}
        </span>
      </div>
      <RetrievalFunnel events={events} />
      <div className="trace-stream" ref={ref} aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const node =
            item.kind === "agent_step" ? (
              <AgentStepNode start={item.start} end={item.end} />
            ) : item.kind === "proposals" ? (
              <ProposalsNode events={item.events} />
            ) : (
              <TraceEvent event={item.ev} finished={item.finished} />
            );

          if (isDev && item.demo) {
            return (
              <div key={item.key} style={{ position: "relative" }}>
                {node}
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    fontFamily: "var(--mono)",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--gold)",
                    background: "var(--gold-glow)",
                    border: "1px solid rgba(212, 166, 97, 0.3)",
                    borderRadius: 3,
                    padding: "2px 5px",
                  }}
                  title="This event came from the baked DEMO_TRACE because the backend hasn't emitted this type yet."
                >
                  demo
                </span>
              </div>
            );
          }

          return <span key={item.key}>{node}</span>;
        })}
      </div>
    </div>
  );
}
