import type { StreamEvent } from "@/lib/sse";

type RecommendationsReadyEvent = Extract<StreamEvent, { type: "recommendations_ready" }>;

interface AnswerReadyNodeProps {
  event: RecommendationsReadyEvent;
}

/** Final stamp at the end of the trace stream — gold node + summary line. */
export function AnswerReadyNode({ event }: AnswerReadyNodeProps) {
  const { facilities, candidates_considered, pipeline_ms } = event.data;
  return (
    <div className="trace-event">
      <div className="node done gold" />
      <div className="label" style={{ color: "var(--gold)" }}>
        Answer ready
      </div>
      <div className="title">
        {facilities.length} verified · {candidates_considered} considered ·{" "}
        {(pipeline_ms / 1000).toFixed(1)}s pipeline
      </div>
    </div>
  );
}
