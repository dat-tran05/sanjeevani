import type { StreamEvent } from "@/lib/sse";
import { ThinkingNode } from "./ThinkingNode";
import { ToolCallNode } from "./ToolCallNode";
import { JuryPanel } from "./JuryPanel";
import { ValidatorNode } from "./ValidatorNode";
import { AnswerReadyNode } from "./AnswerReadyNode";

interface TraceEventProps {
  event: StreamEvent;
  finished: boolean;
}

/**
 * Polymorphic single-event renderer. Note that agent_step_* and model_proposal
 * events are handled in TraceStream's pre-render pass so they can be paired
 * (start↔end by step_id) and grouped (proposers A+B side-by-side); they don't
 * reach this switch.
 *
 * text_delta and citation render in the Explorer's main column, not the trace
 * panel — they short-circuit here.
 */
export function TraceEvent({ event, finished }: TraceEventProps) {
  switch (event.type) {
    case "thinking_delta":
      return <ThinkingNode event={event} finished={finished} />;
    case "tool_call":
      return <ToolCallNode event={event} finished={finished} />;
    case "consensus_resolved":
      return <JuryPanel event={event} />;
    case "validator_pass":
      return <ValidatorNode event={event} />;
    case "recommendations_ready":
      return <AnswerReadyNode event={event} />;
    case "error":
      return (
        <ValidatorNode
          event={{
            type: "validator_pass",
            data: { title: "Stream error", body: event.data.message, passed: false },
          }}
        />
      );
    case "agent_step_start":
    case "agent_step_end":
    case "model_proposal":
    case "text_delta":
    case "citation":
      return null;
  }
}
