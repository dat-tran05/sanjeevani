import type { StreamEvent } from "@/lib/sse";

type ModelProposalEvent = Extract<StreamEvent, { type: "model_proposal" }>;

interface ProposalsNodeProps {
  /**
   * Both proposers' events. Order doesn't matter — proposer_id "A" is
   * always rendered on the left, "B" on the right.
   */
  events: ModelProposalEvent[];
}

/**
 * Renders the Mixture-of-Agents proposers as side-by-side cards. Frontend
 * waits to receive all proposer events before rendering this widget so the
 * layout doesn't reflow.
 */
export function ProposalsNode({ events }: ProposalsNodeProps) {
  const sorted = [...events].sort((a, b) =>
    a.data.proposer_id.localeCompare(b.data.proposer_id)
  );
  const title = sorted[0]?.data.title ?? "Proposed answers";

  return (
    <div className="trace-event">
      <div className="node done" />
      <div className="label">Proposers · MoA</div>
      <div className="title">{title}</div>
      <div className="proposals">
        {sorted.map((p) => (
          <div key={p.data.proposer_id} className="proposal">
            <div className="head">
              <span className="vendor">{p.data.proposer_id}</span> · {p.data.vendor}
            </div>
            <div className="text">{p.data.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
