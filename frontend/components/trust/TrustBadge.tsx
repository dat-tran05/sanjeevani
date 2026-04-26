import type { FacilityTrust } from "@/lib/types";

interface TrustBadgeProps {
  trust: FacilityTrust;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const DIMS = [
  { key: "existence", label: "Existence" },
  { key: "coherence", label: "Coherence" },
  { key: "recency", label: "Recency" },
  { key: "specificity", label: "Specificity" },
] as const;

export function TrustBadge({ trust, size = "md", showLabel = false }: TrustBadgeProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className={`trust-badge ${size}`}>
        {DIMS.map((d) => {
          const val = trust[d.key];
          return (
            <div
              key={d.key}
              className="trust-bar"
              data-dim={d.key}
              title={`${d.label}: ${val}/3`}
            >
              <div className="fill" style={{ height: `${(val / 3) * 100}%` }} />
            </div>
          );
        })}
      </div>
      {showLabel && (
        <div className="trust-badge-label">
          <span className="num">{trust.score.toFixed(2)}</span>
          <span>Trust</span>
        </div>
      )}
    </div>
  );
}
