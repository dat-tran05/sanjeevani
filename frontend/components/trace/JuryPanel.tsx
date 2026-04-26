import type { StreamEvent } from "@/lib/sse";

type ConsensusEvent = Extract<StreamEvent, { type: "consensus_resolved" }>;

interface JuryPanelProps {
  event: ConsensusEvent;
  /** 1-based ordinal among consecutive jury panels in the trace. */
  index?: number;
  /** Total jury panels in this trace (for "1 of 3"). */
  total?: number;
}

const VERDICT_LABEL: Record<"supported" | "partial" | "unsupported", string> = {
  supported: "✓ SUPPORTED",
  partial: "⚠ PARTIAL",
  unsupported: "✗ UNSUPPORTED",
};

/**
 * The signature wow-shot of the demo. Renders the three-judge jury verdict:
 *   - header with claim, consensus verdict pill, and 3-segment agreement bar
 *     (green for agreement, crimson for dissent, animated 120ms stagger);
 *   - 3-column grid of judges, dissenting columns glow crimson;
 *   - optional tiebreaker row when all 3 initially disagreed.
 */
export function JuryPanel({ event, index, total }: JuryPanelProps) {
  const d = event.data;
  const segs = [0, 1, 2].map((i) => i < d.agreement);
  const dissentSegs = d.dissent ? 3 - d.agreement : 0;
  const ordinal =
    index && total && total > 1
      ? `Jury verdict ${index} of ${total} · 3 judges`
      : "Jury · 3 judges";

  return (
    <div className="trace-event">
      <div className={"node " + (d.dissent ? "dissent" : "done")} />
      <div className="label">{ordinal}</div>
      <div className="jury-panel">
        <div className="jury-head">
          <div className="top">
            <h4>{d.title ?? "Verdict"}</h4>
            <span
              className={
                "jury-verdict-pill " +
                (d.verdict === "supported" ? "" : d.verdict)
              }
            >
              {VERDICT_LABEL[d.verdict]}
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--fg-mute)",
              letterSpacing: "0.05em",
            }}
          >
            {d.claim}
          </div>
          <div className="jury-agree">
            <div className="jury-agree-bar">
              {segs.map((on, i) => (
                <div
                  key={i}
                  className={"jury-agree-seg" + (on ? " fill" : "")}
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
              {Array.from({ length: dissentSegs }).map((_, i) => (
                <div
                  key={`d${i}`}
                  className="jury-agree-seg dissent fill"
                  style={{ animationDelay: `${(d.agreement + i) * 120}ms` }}
                />
              ))}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: d.dissent ? "var(--crimson)" : "var(--green)",
                whiteSpace: "nowrap",
              }}
            >
              {d.agreement} of 3 agree
              {d.dissent && <span> · {3 - d.agreement} dissent</span>}
            </div>
          </div>
        </div>
        <div className="jury-cols">
          {d.judges.map((j, i) => {
            const dissents = j.verdict !== d.verdict;
            return (
              <div key={i} className={"jury-col" + (dissents ? " dissents" : "")}>
                <div className="judge">
                  <div className="judge-name">{j.name}</div>
                  <div className="judge-vendor">{j.vendor}</div>
                </div>
                <div className="verdict-row">
                  <span
                    className={
                      "jury-verdict-pill " +
                      (j.verdict === "supported" ? "" : j.verdict)
                    }
                  >
                    {j.verdict.toUpperCase()}
                  </span>
                  <span className="conf">conf {j.confidence.toFixed(2)}</span>
                </div>
                <div className="quote">&ldquo;{j.excerpt}&rdquo;</div>
                {j.dissent_note && <div className="dissent-note">{j.dissent_note}</div>}
              </div>
            );
          })}
        </div>
        {d.tiebreaker && (
          <div className="tiebreaker">
            <div className="glyph">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1c2.5 0 4.5 2 4.5 4.5 0 1.4-.6 2.6-1.6 3.4l-.4 2.1H5.5l-.4-2.1A4.5 4.5 0 0 1 8 1Z M6 13h4M7 15h2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="body">
              <strong>Tiebreaker · {d.tiebreaker.model}</strong> resolved to{" "}
              <strong>{d.tiebreaker.verdict}</strong>. {d.tiebreaker.reasoning}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
