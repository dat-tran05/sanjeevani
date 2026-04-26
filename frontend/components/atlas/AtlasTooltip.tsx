import { gapColor } from "@/lib/maps/geo-utils";

interface AtlasTooltipProps {
  x: number;
  y: number;
  kind: "state" | "district";
  name: string;
  capital?: string;
  districts?: number;
  state?: string;
  facs: number;
  verified: number;
  gap: number;
}

export function AtlasTooltip({
  x,
  y,
  kind,
  name,
  capital,
  districts,
  state,
  facs,
  verified,
  gap,
}: AtlasTooltipProps) {
  return (
    <div
      className="atlas-tooltip visible"
      style={{ left: x, top: y }}
    >
      <div className="name">{name}</div>
      {kind === "state" ? (
        <>
          <div className="stat">
            {districts} districts · {facs} facilities · {verified} verified
          </div>
          <div className="stat" style={{ color: "var(--fg-mute)" }}>
            capital · {capital}
          </div>
        </>
      ) : (
        <div className="stat">
          {state} · {facs} facilities · {verified} verified
        </div>
      )}
      <span
        className="gap-pill"
        style={{
          background: gapColor(gap),
          color: gap > 0.5 ? "#1A1409" : "#0A1A12",
        }}
      >
        gap {gap.toFixed(2)}
      </span>
      {kind === "state" && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            color: "var(--fg-mute)",
            fontFamily: "var(--mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          click to focus
        </div>
      )}
    </div>
  );
}
