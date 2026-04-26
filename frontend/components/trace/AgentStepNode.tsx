import type { StreamEvent } from "@/lib/sse";

type AgentStepStartEvent = Extract<StreamEvent, { type: "agent_step_start" }>;
type AgentStepEndEvent = Extract<StreamEvent, { type: "agent_step_end" }>;

interface AgentStepNodeProps {
  event: AgentStepStartEvent | AgentStepEndEvent;
  /** True when the step has reached its `agent_step_end` companion. */
  finished: boolean;
}

/**
 * Renders a LangGraph node lifecycle event as a timeline node — spinner while
 * running, gold checkmark when finished. Title comes from the start event's
 * label; body (when finished) is the end event's summary.
 */
export function AgentStepNode({ event, finished }: AgentStepNodeProps) {
  const isStart = event.type === "agent_step_start";
  const label = isStart ? event.data.label : event.data.name;
  const summary = !isStart ? event.data.summary : undefined;
  const durationMs = !isStart ? event.data.duration_ms : undefined;

  return (
    <div className="trace-event">
      <div className={"node " + (finished ? "done" : "spinner")} />
      <div className="label">
        {label}
        {durationMs !== undefined && <span className="ts">· {Math.round(durationMs)}ms</span>}
      </div>
      {summary && <div className="title">{summary}</div>}
    </div>
  );
}
