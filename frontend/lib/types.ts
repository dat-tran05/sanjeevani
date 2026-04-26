// Sanjeevani — domain types.
// Shared between frontend components and the SSE event contract (lib/sse.ts).
// See docs/superpowers/specs/2026-04-25-sanjeevani-design-wireup.md §SSE & Domain Type Contract.

export interface FacilityTrust {
  existence: 0 | 1 | 2 | 3;
  coherence: 0 | 1 | 2 | 3;
  recency: 0 | 1 | 2 | 3;
  specificity: 0 | 1 | 2 | 3;
  /** 0–1 aggregate; displayed only as adjunct, never as the sole signal. */
  score: number;
}

export interface FacilityCitation {
  /** Local id, e.g. "c1" — referenced by URL ?citation= param. */
  id: string;
  column: "description" | "capability" | "procedure" | "equipment" | string;
  char_start: number;
  char_end: number;
  /** The exact source span (the highlighted text). */
  text: string;
}

export type Verdict = "supported" | "partial" | "unsupported";

export interface CapabilityVerdict {
  /** Display name, e.g. "Emergency Surgery". */
  name: string;
  agree: "3/3" | "2/3" | "1/3" | "0/3";
  verdict: Verdict;
}

export interface RecommendedFacility {
  /** Stable id, e.g. "F-MZN-0214". */
  id: string;
  name: string;
  /** Display facility type, e.g. "Government Hospital". */
  type: string;
  state: string;
  district: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  trust: FacilityTrust;
  capabilities: CapabilityVerdict[];
  citations: FacilityCitation[];
  /** Full free-text description; citations index char offsets into this string. */
  description: string;
  /**
   * Optional 2-3 sentence rationale produced by the backend aggregator,
   * containing inline `{c1}` / `{c2}` citation markers replaced at render
   * time by the matching CitationPill. Absent on demo data — ReasonLine
   * falls back to per-facility hardcoded prose for those.
   */
  prose?: string;
  /** Source-CSV listed specialties (silver.facilities_parsed.specialties). */
  specialties?: string[];
  /** Source-CSV listed procedures. */
  procedures?: string[];
  /** Source-CSV listed equipment. */
  equipment?: string[];
  /** LLM-extracted: facility self-claims surgery capability. */
  surgery_capable?: boolean | null;
  /** LLM-extracted: facility self-claims 24/7 emergency. */
  emergency_24_7?: boolean | null;
}

export interface ExcludedFacility {
  name: string;
  district: string;
  type: string;
  /** One-sentence reason the facility was excluded. */
  reason: string;
  verdict: "partial" | "unsupported";
}

/** Slim facility record used by the Atlas pin layer (deck.gl Scatterplot). */
export interface MapFacility {
  /** SHA256 facility_id from Databricks silver.facilities_parsed — joinable to /facilities/{id}. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  city: string;
  /** Normalized facility type: hospital | clinic | dentist | doctor | pharmacy | other. */
  type: string;
  /** True if facility has ≥1 row in gold.trust_verdicts (multi-judge jury verified). */
  verified?: boolean;
}

export interface DistrictPoint {
  /** Short district id, e.g. "MZN". */
  id: string;
  name: string;
  state: string;
  pop: number;
  facs: number;
  verified: number;
  /** 0 = well-served, 1 = severe gap. */
  gap: number;
  lng: number;
  lat: number;
}

export interface StateGeo {
  /** Two-letter state code, e.g. "BR" for Bihar. */
  id: string;
  name: string;
  abbr: string;
  capital: string;
  /** GeoJSON-style polygon rings ([lng, lat] pairs). */
  rings: Array<Array<[number, number]>>;
}

export type CapabilityId =
  | "emergency"
  | "neonatal"
  | "dialysis"
  | "oncology"
  | "cardiac"
  | "trauma";

export interface CapabilityDef {
  id: CapabilityId;
  /** Display label, e.g. "Emergency Surgery". */
  label: string;
}

export interface HeroQuery {
  id: string;
  /** Short label for suggestion chips. */
  label: string;
  /** Full natural-language query text. */
  text: string;
  /** Display-serif answer line shown above ranked recommendations. */
  answerLine: string;
}
