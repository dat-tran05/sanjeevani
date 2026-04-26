import type { StreamEvent } from "@/lib/sse";

type AgentStepStartEvent = Extract<StreamEvent, { type: "agent_step_start" }>;
type AgentStepEndEvent = Extract<StreamEvent, { type: "agent_step_end" }>;

interface AgentStepNodeProps {
  start: AgentStepStartEvent;
  end?: AgentStepEndEvent | null;
  /** Optional thinking blob to expose under "Show thinking". */
  thinkingText?: string;
}

/**
 * Splits a label of the form "Intent extraction · Llama 3.3" into a
 * (heading, model) pair. Falls back to (label, undefined) if no separator.
 */
function splitLabel(label: string): [string, string | undefined] {
  const sep = label.indexOf(" · ");
  if (sep === -1) return [label, undefined];
  return [label.slice(0, sep), label.slice(sep + 3)];
}

/**
 * Renders a LangGraph node lifecycle as a timeline card in the design's
 * style: spinner→checkmark dot, heading + model pill, mono detail block
 * (from `agent_step_end.data.detail`), and an optional "Show thinking"
 * expando when extended-thinking text was emitted for this step.
 */
export function AgentStepNode({ start, end, thinkingText }: AgentStepNodeProps) {
  const finished = !!end;
  const [heading, model] = splitLabel(start.data.label);
  const summary = end?.data.summary;
  const detail = end?.data.detail;
  const durationMs = end?.data.duration_ms;

  return (
    <div className="trace-event step-card">
      <div className={"node " + (finished ? "done" : "spinner")} />
      <div className="step-head">
        <span className="step-heading">{heading}</span>
        {durationMs !== undefined && (
          <span className="step-ts">· {Math.round(durationMs)}ms</span>
        )}
        {model && <span className="step-model">{model}</span>}
      </div>
      {summary && <div className="step-summary">{summary}</div>}
      {detail && <pre className="step-detail">{detail}</pre>}
      {thinkingText && (
        <details className="step-thinking">
          <summary className="step-thinking-toggle">Show thinking</summary>
          <div className="step-thinking-body">{thinkingText}</div>
        </details>
      )}
    </div>
  );
}
