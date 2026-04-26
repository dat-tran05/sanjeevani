import type { ExcludedFacility } from "@/lib/types";

// Source: design data.js SANJ.EXCLUSIONS — pasted verbatim. Fields match the
// ExcludedFacility contract exactly (name, district, type, reason, verdict).

export const EXCLUSIONS: ExcludedFacility[] = [
  {
    name: "Patliputra Polyclinic",
    district: "Patna · Bihar",
    type: "Polyclinic",
    reason: "Listed orthopedics specialty but no surgery procedure cited",
    verdict: "unsupported"
  },
  {
    name: "Begusarai Janta Hospital",
    district: "Begusarai · Bihar",
    type: "General Hospital",
    reason: "Trust verdict on emergency surgery: unsupported (3 of 3 judges)",
    verdict: "unsupported"
  },
  {
    name: "Saharsa Maa Care Centre",
    district: "Saharsa · Bihar",
    type: "Clinic",
    reason: "Capability auto-tagged from surrounding text; no description sentence supports it",
    verdict: "partial"
  },
  {
    name: "Khagaria Lifeline",
    district: "Khagaria · Bihar",
    type: "Hospital",
    reason: "Recency score 0/3 — no verified social or web update since 2021",
    verdict: "unsupported"
  },
  {
    name: "Samastipur Trust Hospital",
    district: "Samastipur · Bihar",
    type: "Hospital",
    reason: "Distance exceeds 80km from queried center; surgery verdict supported but out of radius",
    verdict: "partial"
  },
  {
    name: "Madhubani Wellness",
    district: "Madhubani · Bihar",
    type: "Multi-specialty Clinic",
    reason: "Description cites surgical 'consultation' only — three of three judges flagged as scope mismatch",
    verdict: "unsupported"
  }
];
