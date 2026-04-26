import type { CapabilityDef } from "@/lib/types";

// Capability defs. Source: project/data.js SANJ.CAPABILITIES (also mirrored in
// project/india-geo.js). All ids match the CapabilityId union in lib/types.ts.
export const CAPABILITIES: CapabilityDef[] = [
  { id: "emergency", label: "Emergency Surgery" },
  { id: "neonatal",  label: "Neonatal ICU" },
  { id: "dialysis",  label: "Dialysis" },
  { id: "oncology",  label: "Oncology" },
  { id: "cardiac",   label: "Cardiac" },
  { id: "trauma",    label: "Trauma" },
];

// Per-capability state-id -> multiplier overlay used to recolor the choropleth.
// Source: project/india-geo.js SANJ.CAP_BIAS (the canonical one consumed by
// components-atlas.jsx computeStateGaps; data.js has a near-duplicate
// SANJ.CAPABILITY_GAP_BIAS — using the india-geo.js values, which the Atlas
// reads from `window.SANJ.CAP_BIAS`). Outer keys are capability ids, inner
// keys are 2-letter state ids.
export const CAP_BIAS: Record<string, Record<string, number>> = {
  emergency: { BR: 1.15, UP: 1.10, JH: 1.12, OD: 1.10, RJ: 1.05, MH: 0.85, KL: 0.80, KA: 0.85, TN: 0.85, DL: 0.65, GJ: 0.92, MP: 1.00, WB: 0.95 },
  neonatal:  { BR: 1.30, UP: 1.20, JH: 1.20, OD: 1.18, RJ: 1.10, MH: 0.85, KL: 0.72, KA: 0.85, TN: 0.85, DL: 0.60, GJ: 0.92, MP: 1.05, WB: 0.95 },
  dialysis:  { BR: 1.10, UP: 1.05, JH: 1.08, OD: 1.06, RJ: 1.02, MH: 0.78, KL: 0.74, KA: 0.80, TN: 0.80, DL: 0.55, GJ: 0.90, MP: 1.00, WB: 0.92 },
  oncology:  { BR: 1.32, UP: 1.22, JH: 1.22, OD: 1.20, RJ: 1.12, MH: 0.76, KL: 0.76, KA: 0.80, TN: 0.78, DL: 0.52, GJ: 0.90, MP: 1.08, WB: 0.92 },
  cardiac:   { BR: 1.20, UP: 1.10, JH: 1.14, OD: 1.10, RJ: 1.06, MH: 0.76, KL: 0.76, KA: 0.78, TN: 0.76, DL: 0.52, GJ: 0.88, MP: 1.04, WB: 0.90 },
  trauma:    { BR: 1.14, UP: 1.10, JH: 1.12, OD: 1.08, RJ: 1.06, MH: 0.85, KL: 0.85, KA: 0.85, TN: 0.85, DL: 0.65, GJ: 0.92, MP: 1.02, WB: 0.95 },
};
