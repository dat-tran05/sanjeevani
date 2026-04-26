import type { CapabilityId } from "@/lib/types";
import { CAPABILITIES } from "@/lib/demo/capability-bias";

interface CapabilitySegmentedProps {
  value: CapabilityId;
  onChange: (id: CapabilityId) => void;
}

export function CapabilitySegmented({ value, onChange }: CapabilitySegmentedProps) {
  return (
    <div className="atlas-segmented">
      {CAPABILITIES.map((c) => (
        <button
          key={c.id}
          className={"atlas-seg" + (c.id === value ? " active" : "")}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
