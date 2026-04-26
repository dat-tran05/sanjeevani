import type { RecommendedFacility } from "@/lib/types";

// Source: design data.js SANJ.FACILITIES — pasted verbatim, with latitude/longitude
// added (the design source omitted them). The design payload also carries a few
// fields beyond the RecommendedFacility contract (population_served on F-MZN-0214;
// excerpt on every CapabilityVerdict; tiebreaker on one capability). They are
// preserved verbatim via `as unknown as RecommendedFacility` so downstream code
// that knows about them can read them; the typed surface stays clean.

export const FACILITIES: Record<string, RecommendedFacility> = {
  "F-MZN-0214": {
    id: "F-MZN-0214",
    name: "Sri Krishna Medical Centre",
    type: "Multi-specialty Hospital",
    state: "Bihar",
    district: "Muzaffarpur",
    latitude: 26.1224,
    longitude: 85.3614,
    distance_km: 18.4,
    population_served: "approx. 4.8M (district)",
    description:
      "Sri Krishna Medical Centre operates a 24-hour emergency theatre with on-call general surgery, anesthesia, and post-op recovery. Established in 2003, the hospital lists laparoscopic appendectomy among its routine procedures and maintains a six-bed surgical ICU. Verified ambulance service covers 80km radius. The facility runs an active outpatient department for general surgery six days a week. Equipment cited includes ultrasound, mobile X-ray, and a single CT scanner installed in 2021.",
    citations: [
      { id: "c1", char_start: 26, char_end: 76, column: "description", text: "operates a 24-hour emergency theatre with on-call general surgery" },
      { id: "c2", char_start: 159, char_end: 208, column: "description", text: "laparoscopic appendectomy among its routine procedures" },
      { id: "c3", char_start: 232, char_end: 254, column: "description", text: "six-bed surgical ICU" },
      { id: "c4", char_start: 282, char_end: 313, column: "description", text: "ambulance service covers 80km radius" }
    ],
    trust: { existence: 3, coherence: 3, recency: 2, specificity: 3, score: 0.91 },
    capabilities: [
      { name: "Emergency Surgery", verdict: "supported", agree: "3/3", excerpt: "24-hour emergency theatre with on-call general surgery" },
      { name: "General Anesthesia", verdict: "supported", agree: "3/3", excerpt: "on-call... anesthesia, and post-op recovery" },
      { name: "Laparoscopic Procedures", verdict: "supported", agree: "3/3", excerpt: "lists laparoscopic appendectomy among its routine procedures" },
      { name: "Surgical ICU", verdict: "supported", agree: "3/3", excerpt: "six-bed surgical ICU" },
      { name: "Imaging — CT", verdict: "partial", agree: "2/3", excerpt: "single CT scanner installed in 2021" }
    ]
  } as unknown as RecommendedFacility,
  "F-DBH-0109": {
    id: "F-DBH-0109",
    name: "Darbhanga Civil Hospital",
    type: "District Hospital",
    state: "Bihar",
    district: "Darbhanga",
    latitude: 26.1500,
    longitude: 85.9000,
    distance_km: 41.7,
    description:
      "Darbhanga Civil Hospital is a district-level facility with general surgery, obstetrics, and outpatient services. The hospital description references emergency intake and a small operating theatre, though specific procedure listings are limited. Last website update: November 2024. Doctor count of 14 reported on facility profile.",
    citations: [
      { id: "c1", char_start: 84, char_end: 127, column: "description", text: "general surgery, obstetrics" },
      { id: "c2", char_start: 167, char_end: 209, column: "description", text: "emergency intake and a small operating theatre" }
    ],
    trust: { existence: 3, coherence: 2, recency: 2, specificity: 1, score: 0.68 },
    capabilities: [
      { name: "Emergency Surgery", verdict: "partial", agree: "2/3", excerpt: "emergency intake and a small operating theatre" },
      { name: "General Surgery", verdict: "supported", agree: "3/3", excerpt: "general surgery, obstetrics, and outpatient services" },
      { name: "Surgical Equipment Detail", verdict: "unsupported", agree: "0/3", excerpt: "no equipment list cited" }
    ]
  } as unknown as RecommendedFacility,
  "F-PAT-0331": {
    id: "F-PAT-0331",
    name: "Vaishali Surgical & Trauma Centre",
    type: "Specialty Surgical Centre",
    state: "Bihar",
    district: "Vaishali",
    latitude: 25.6100,
    longitude: 85.1400,
    distance_km: 62.1,
    description:
      "Vaishali Surgical & Trauma Centre describes itself as a referral facility for abdominal surgery, trauma stabilization, and orthopedic interventions. Operates around the clock per posted notice. Equipment list is general — references operation theatre and ICU but does not specify staffing or count. Most recent social post: March 2026.",
    citations: [
      { id: "c1", char_start: 53, char_end: 121, column: "description", text: "referral facility for abdominal surgery, trauma stabilization" },
      { id: "c2", char_start: 158, char_end: 199, column: "description", text: "Operates around the clock per posted notice" },
      { id: "c3", char_start: 254, char_end: 286, column: "description", text: "operation theatre and ICU" }
    ],
    trust: { existence: 2, coherence: 2, recency: 3, specificity: 1, score: 0.61 },
    capabilities: [
      { name: "Emergency Surgery", verdict: "partial", agree: "1/3", excerpt: "abdominal surgery, trauma stabilization", tiebreaker: true },
      { name: "Trauma Care", verdict: "supported", agree: "3/3", excerpt: "trauma stabilization" }
    ]
  } as unknown as RecommendedFacility
};

export const HERO_FACILITY_IDS = ["F-MZN-0214", "F-DBH-0109", "F-PAT-0331"] as const;
