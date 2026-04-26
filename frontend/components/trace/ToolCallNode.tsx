import type { StreamEvent } from "@/lib/sse";

type ToolCallEvent = Extract<StreamEvent, { type: "tool_call" }>;

interface ToolCallNodeProps {
  event: ToolCallEvent;
  finished: boolean;
}

/**
 * Tool invocation card — mono-typeset, paired with a model-style tool pill.
 * `output_summary` renders below in a code block; `duration_ms` ticks next
 * to the heading. Mirrors the AgentStepNode visual rhythm so adjacent cards
 * feel like part of the same timeline.
 */
export function ToolCallNode({ event, finished }: ToolCallNodeProps) {
  const { tool, output_summary, duration_ms } = event.data;
  return (
    <div className="trace-event step-card">
      <div className={"node " + (finished ? "done" : "spinner")} />
      <div className="step-head">
        <span className="step-heading">Tool call</span>
        {duration_ms !== undefined && (
          <span className="step-ts">· {Math.round(duration_ms)}ms</span>
        )}
        <span className="step-model tool">{tool}</span>
      </div>
      {output_summary && <pre className="step-detail">{output_summary}</pre>}
    </div>
  );
}
