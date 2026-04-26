import type { StreamEvent } from "@/lib/sse";

type ValidatorEvent = Extract<StreamEvent, { type: "validator_pass" }>;

interface ValidatorNodeProps {
  event: ValidatorEvent;
}

/**
 * Renders the post-MoA validator agent's verdict — gold node, "Validator"
 * label, body explains whether the recommendation passes the fresh-context
 * re-check.
 */
export function ValidatorNode({ event }: ValidatorNodeProps) {
  const { title, body, passed } = event.data;
  return (
    <div className="trace-event">
      <div className={"node done " + (passed ? "gold" : "dissent")} />
      <div className="label">Validator</div>
      <div className="title">{title}</div>
      <div className="body">{body}</div>
    </div>
  );
}
