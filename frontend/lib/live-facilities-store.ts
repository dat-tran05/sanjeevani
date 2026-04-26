/**
 * Module-level cache for facilities returned by the backend's
 * `recommendations_ready` event. The Explorer page writes to this when a
 * stream completes; the FacilityDrawer reads from it (via useFacility) so
 * clicks on a card open with the FULL streamed data — description,
 * citations, capabilities — instead of refetching from /facilities/{id}
 * (which doesn't return citations or capabilities).
 */
import type { RecommendedFacility } from "@/lib/types";

const store = new Map<string, RecommendedFacility>();
const subscribers = new Set<() => void>();

export function setLiveFacilities(facilities: RecommendedFacility[]): void {
  for (const f of facilities) store.set(f.id, f);
  // Notify drawer / any other listener that new data is available.
  subscribers.forEach((cb) => cb());
}

export function getLiveFacility(id: string | null): RecommendedFacility | null {
  if (!id) return null;
  return store.get(id) ?? null;
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
