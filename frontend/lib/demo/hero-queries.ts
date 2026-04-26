import type { HeroQuery } from "@/lib/types";

// Source: design data.js SANJ.HERO_QUERIES — pasted verbatim. The design payload
// also carries `intent` and `activeRegion` per entry which are outside the
// HeroQuery contract; preserved via `as unknown as HeroQuery[]` so callers that
// know about them can read them.

export const HERO_QUERIES: HeroQuery[] = [
  {
    id: "bihar-appendectomy",
    label: "Rural Bihar · Emergency appendectomy",
    text: "nearest rural Bihar facility for emergency appendectomy",
    intent: { capability: "emergency_surgery", region: "Bihar", urgency: "emergent", radius_km: 80 },
    answerLine:
      "Three rural Bihar facilities are most likely to handle an emergency appendectomy tonight, ranked by verified capability and trust. The strongest candidate is in Muzaffarpur — three of three judges agree the description cites a 24-hour emergency theatre. The second carries a partial verdict; surgical capability is implied but not explicitly stated. The third is escalated to extended-thinking tiebreaker — Llama dissents on equipment specificity.",
    activeRegion: "BR"
  },
  {
    id: "mumbai-dialysis",
    label: "Mumbai · Dialysis under 10km",
    text: "Mumbai dialysis under 10km",
    intent: { capability: "dialysis", region: "Maharashtra", radius_km: 10 },
    answerLine:
      "Twelve Mumbai facilities verify dialysis service within a 10km radius. The top three combine high recency signals with explicit nephrology citations.",
    activeRegion: "MH"
  },
  {
    id: "neonatal-deserts",
    label: "Districts · Zero verified neonatal ICUs",
    text: "districts with zero verified neonatal ICUs",
    intent: { capability: "neonatal_icu", scope: "district_aggregate" },
    answerLine:
      "Forty-one districts across nine states have zero facilities with a verifiable neonatal ICU citation. Bihar, eastern Uttar Pradesh, and Jharkhand carry the highest concentration of gaps.",
    activeRegion: "BR"
  }
] as unknown as HeroQuery[];
