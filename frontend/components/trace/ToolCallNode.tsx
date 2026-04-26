import type { StreamEvent } from "@/lib/sse";

type ToolCallEvent = Extract<StreamEvent, { type: "tool_call" }>;

interface ToolCallNodeProps {
  event: ToolCallEvent;
  finished: boolean;
}

/**
 * Renders a tool invocation as a mono-typed node — input args summarized
 * inline, output_summary in the body. Spinner while running, check on done.
 */
export function ToolCallNode({ event, finished }: ToolCallNodeProps) {
  const { tool, output_summary, duration_ms } = event.data;
  return (
    <div className="trace-event">
      <div className={"node " + (finished ? "done" : "spinner")} />
      <div className="label">
        Tool call
        {duration_ms !== undefined && <span className="ts">· {Math.round(duration_ms)}ms</span>}
      </div>
      <div
        className="title"
        style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--fg-2)" }}
      >
        {tool}
      </div>
      {output_summary && <div className="tool-out">{output_summary}</div>}
    </div>
  );
}
