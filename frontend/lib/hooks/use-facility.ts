"use client";

import { useEffect, useState } from "react";
import { FACILITIES } from "@/lib/demo/facilities";
import { getLiveFacility, subscribe } from "@/lib/live-facilities-store";
import type {
  CapabilityVerdict,
  FacilityCitation,
  FacilityTrust,
  RecommendedFacility,
} from "@/lib/types";

interface FacilityDetailResponse {
  id: string;
  name: string;
  state?: string;
  city?: string;
  lat?: number | null;
  lon?: number | null;
  description?: string;
  type?: string;
  specialties?: string[];
  procedures?: string[];
  equipment?: string[];
  surgery_capable?: boolean | null;
  emergency_24_7?: boolean | null;
  trust_badge?: {
    existence: number;
    coherence: number;
    recency: number;
    specificity: number;
  } | null;
}

// Module-level cache so re-opening the same facility doesn't re-hit the API.
const cache = new Map<string, RecommendedFacility>();
const inflight = new Map<string, Promise<RecommendedFacility | null>>();

// Backend stores trust dimensions as 0–1 floats (databricks 09_trust_scores.py);
// the UI badge uses a 0–3 ordinal — scale at the API boundary.
function clampDim(n: number): 0 | 1 | 2 | 3 {
  return Math.round(Math.max(0, Math.min(3, n * 3))) as 0 | 1 | 2 | 3;
}

function buildTrust(
  badge: FacilityDetailResponse["trust_badge"]
): FacilityTrust {
  if (!badge) {
    return { existence: 0, coherence: 0, recency: 0, specificity: 0, score: 0 };
  }
  const e = clampDim(badge.existence);
  const c = clampDim(badge.coherence);
  const r = clampDim(badge.recency);
  const s = clampDim(badge.specificity);
  return { existence: e, coherence: c, recency: r, specificity: s, score: (e + c + r + s) / 12 };
}

async function fetchFacility(id: string): Promise<RecommendedFacility | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  if (inflight.has(id)) return inflight.get(id) ?? null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const p = (async (): Promise<RecommendedFacility | null> => {
    try {
      const r = await fetch(`${apiUrl}/facilities/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!r.ok) return null;
      const detail = (await r.json()) as FacilityDetailResponse;
      const trust = buildTrust(detail.trust_badge ?? null);
      const facility: RecommendedFacility = {
        id: detail.id,
        name: detail.name,
        type: detail.type ?? "Facility",
        state: detail.state ?? "",
        district: detail.city ?? "",
        latitude: detail.lat ?? 0,
        longitude: detail.lon ?? 0,
        distance_km: 0,
        trust,
        capabilities: [] as CapabilityVerdict[],
        citations: [] as FacilityCitation[],
        description: detail.description ?? "",
        specialties: detail.specialties ?? [],
        procedures: detail.procedures ?? [],
        equipment: detail.equipment ?? [],
        surgery_capable: detail.surgery_capable ?? null,
        emergency_24_7: detail.emergency_24_7 ?? null,
      };
      cache.set(id, facility);
      return facility;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/**
 * Resolves a facility by id. Priority:
 *   1. Live store (set by Explorer when recommendations_ready arrives) —
 *      richest payload: prose, citations, capabilities, description.
 *   2. Bundled FACILITIES demo dict (for `?demo=1` and the three design IDs).
 *   3. /facilities/{id} REST endpoint — basic facility metadata + trust badge,
 *      no citations or per-claim capabilities.
 */
export function useFacility(id: string | null): {
  facility: RecommendedFacility | null;
  loading: boolean;
} {
  const [facility, setFacility] = useState<RecommendedFacility | null>(() =>
    id ? getLiveFacility(id) ?? cache.get(id) ?? FACILITIES[id] ?? null : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setFacility(null);
      return;
    }
    const live = getLiveFacility(id);
    if (live) {
      setFacility(live);
      return;
    }
    if (FACILITIES[id]) {
      setFacility(FACILITIES[id]);
      return;
    }
    if (cache.has(id)) {
      setFacility(cache.get(id) ?? null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFacility(id).then((f) => {
      if (cancelled) return;
      setFacility(f);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // If the live store updates after this hook mounted (e.g. drawer opened
  // via deep link before the stream finished), pick up the richer payload.
  useEffect(() => {
    if (!id) return;
    return subscribe(() => {
      const live = getLiveFacility(id);
      if (live) setFacility(live);
    });
  }, [id]);

  return { facility, loading };
}
