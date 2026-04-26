import type { CapabilityId } from "@/lib/types";
import { CAPABILITIES } from "@/lib/demo/capability-bias";

interface AtlasLegendProps {
  capability: CapabilityId;
}

export function AtlasLegend({ capability }: AtlasLegendProps) {
  const capLabel = CAPABILITIES.find((c) => c.id === capability)?.label ?? "";

  return (
    <div className="atlas-legend">
      <h5>Capability gap · {capLabel}</h5>
      <div
        className="gradbar"
        style={{
          background:
            "linear-gradient(90deg, #1A6B4A, #34C58A 25%, #BFA46A 55%, #C07D4A 75%, #C04A3F)",
        }}
      />
      <div className="gradlabels">
        <span>well-served</span>
        <span>severe gap</span>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: "var(--fg-3)",
          lineHeight: 1.5,
        }}
      >
        Bubble size = facility count · Color = gap severity
      </div>
    </div>
  );
}
