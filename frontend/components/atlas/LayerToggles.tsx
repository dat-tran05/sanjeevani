interface LayerTogglesValue {
  choropleth: boolean;
  pins: boolean;
  labels: boolean;
  deserts: boolean;
}

interface LayerTogglesProps {
  value: LayerTogglesValue;
  onChange: (next: LayerTogglesValue) => void;
}

const ROWS: Array<{ k: keyof LayerTogglesValue; lbl: string }> = [
  { k: "choropleth", lbl: "Capability gaps" },
  { k: "deserts", lbl: "Severe-gap markers" },
  { k: "pins", lbl: "District bubbles" },
  { k: "labels", lbl: "Labels" },
];

function swatchBackground(k: keyof LayerTogglesValue): string {
  if (k === "choropleth")
    return "linear-gradient(90deg, #34C58A, #BFA46A, #C04A3F)";
  if (k === "deserts")
    return "repeating-linear-gradient(45deg, #C04A3F 0 2px, transparent 2px 5px)";
  if (k === "pins") return "#BFA46A";
  return "var(--fg-3)";
}

export function LayerToggles({ value, onChange }: LayerTogglesProps) {
  return (
    <div className="atlas-layers">
      <h5>Layers</h5>
      {ROWS.map((r) => (
        <div
          key={r.k}
          className={"atlas-layer-row" + (value[r.k] ? " on" : "")}
          onClick={() => onChange({ ...value, [r.k]: !value[r.k] })}
        >
          <span className="swatch" style={{ background: swatchBackground(r.k) }} />
          <span className="lbl">{r.lbl}</span>
          <span className="toggle" />
        </div>
      ))}
    </div>
  );
}
