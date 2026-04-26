// Source/layer factories for the Atlas MapLibre instance.
//
// Polygons come from real GADM-derived GeoJSON shipped under /public:
//   /india-states.geo.json     ~243 KB · 35 states/UTs (NAME_1)
//   /india-districts.geo.json  ~506 KB · 594 districts (NAME_1, NAME_2)
//
// They're loaded once at map init via loadIndiaGeo() and cached at module
// scope so every subsequent enrich*() call is synchronous (the AtlasMap
// effect that re-bakes on capability change must be sync, not Promise-based).
//
// The 50-row hand-curated DISTRICTS_GEO survives as the dataset for the
// "verified facility" point markers (separate `districts-points` source).

import type { Map as MLMap } from "maplibre-gl";
import type { CapabilityId } from "@/lib/types";
import { STATES_GEO } from "@/lib/demo/states-geo";
import { DISTRICTS_GEO, STATE_ID_OF } from "@/lib/demo/districts-geo";
import { CAP_BIAS } from "@/lib/demo/capability-bias";

// ---------------------------------------------------------------------------
// GeoJSON cache (populated by loadIndiaGeo)
// ---------------------------------------------------------------------------

let statesCache: GeoJSON.FeatureCollection | null = null;
let districtsCache: GeoJSON.FeatureCollection | null = null;
let stateCentroidsCache: GeoJSON.FeatureCollection | null = null;

/**
 * Fetch the simplified Datameet/GADM India boundaries once and cache them at
 * module scope. Idempotent — repeat calls are no-ops once primed.
 *
 * MUST be awaited before setupLayers() / enrichStates() / enrichDistricts().
 */
export async function loadIndiaGeo(): Promise<void> {
  if (statesCache && districtsCache) return;
  const [statesRes, districtsRes] = await Promise.all([
    fetch("/india-states.geo.json"),
    fetch("/india-districts.geo.json"),
  ]);
  statesCache = (await statesRes.json()) as GeoJSON.FeatureCollection;
  districtsCache = (await districtsRes.json()) as GeoJSON.FeatureCollection;
  stateCentroidsCache = buildStateCentroidsFromCache(statesCache);
}

// ---------------------------------------------------------------------------
// State name → metadata join (GADM uses NAME_1 like "Andhra Pradesh")
// ---------------------------------------------------------------------------

function normalizeStateName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .replace(/\bjammu and kashmir\b/, "j&k") // GADM: "Jammu and Kashmir" → STATES_GEO: "J&K"
    .replace(/\bnct of delhi\b/, "delhi ncr")
    .replace(/\borissa\b/, "odisha") // GADM may still use legacy "Orissa"
    .replace(/\buttaranchal\b/, "uttarakhand")
    .trim();
}

const STATE_META_BY_NAME: Map<string, (typeof STATES_GEO)[number]> = new Map(
  STATES_GEO.map((s) => [normalizeStateName(s.name), s]),
);

function findStateMeta(gadmName: string) {
  return STATE_META_BY_NAME.get(normalizeStateName(gadmName));
}

// ---------------------------------------------------------------------------
// Polygon centroid (used for state-label symbol layer)
// ---------------------------------------------------------------------------

function polygonRingsCentroid(geometry: GeoJSON.Geometry): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const visit = (rings: GeoJSON.Position[][]) => {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
        n += 1;
      }
    }
  };
  if (geometry.type === "Polygon") visit(geometry.coordinates);
  else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) visit(polygon);
  }
  return n > 0 ? [sx / n, sy / n] : [80, 22];
}

function buildStateCentroidsFromCache(
  fc: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = fc.features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const gadmName = String(props.NAME_1 ?? "");
    const meta = findStateMeta(gadmName);
    return {
      type: "Feature",
      properties: {
        id: meta?.id ?? gadmName,
        name: meta?.name ?? gadmName,
        abbr: meta?.abbr ?? gadmName.slice(0, 3).toUpperCase(),
      },
      geometry: {
        type: "Point",
        coordinates: polygonRingsCentroid(f.geometry),
      },
    };
  });
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Per-capability gap aggregation
// ---------------------------------------------------------------------------

/**
 * Average each state's district .gap × the per-state CAP_BIAS multiplier.
 * Uses the 50-row demo districts as the only "ground truth" until real data
 * lands; states without coverage fall back to a neutral 0.55 baseline × bias.
 */
export function computeStateGaps(
  capability: CapabilityId,
): Record<string, number> {
  const bias = CAP_BIAS[capability] || {};
  const map: Record<string, number> = {};
  for (const s of STATES_GEO) {
    const inState = DISTRICTS_GEO.filter((d) => STATE_ID_OF[d.state] === s.id);
    if (inState.length === 0) {
      map[s.id] = Math.min(1, 0.55 * (bias[s.id] ?? 1.0));
    } else {
      const avg = inState.reduce((a, d) => a + d.gap, 0) / inState.length;
      map[s.id] = Math.max(0, Math.min(1, avg * (bias[s.id] ?? 1)));
    }
  }
  return map;
}

// Deterministic hash → small per-district variation around the state baseline.
// Replace with real per-district aggregates once the 10k facility pipeline
// emits district-keyed counts.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pseudoVariation(districtName: string): number {
  return (hashStr(districtName) % 30) / 100 - 0.15; // -0.15 .. +0.15
}

// ---------------------------------------------------------------------------
// Enriched FeatureCollections (gap baked into properties for color interp)
// ---------------------------------------------------------------------------

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Returns the cached state polygons enriched with id/abbr/capital + gap. */
export function enrichStates(
  capability: CapabilityId,
): GeoJSON.FeatureCollection {
  if (!statesCache) return EMPTY_FC;
  const gaps = computeStateGaps(capability);
  const fc = JSON.parse(JSON.stringify(statesCache)) as GeoJSON.FeatureCollection;
  fc.features.forEach((f) => {
    const raw = (f.properties ?? {}) as Record<string, unknown>;
    const gadmName = String(raw.NAME_1 ?? "");
    const meta = findStateMeta(gadmName);
    f.properties = {
      id: meta?.id ?? gadmName,
      name: meta?.name ?? gadmName,
      abbr: meta?.abbr ?? gadmName.slice(0, 3).toUpperCase(),
      capital: meta?.capital ?? "—",
      gap: meta ? gaps[meta.id] ?? 0.5 : 0.5,
    };
  });
  return fc;
}

/**
 * Returns the cached district polygons enriched with id/name/state/gap.
 * Until real per-district facility counts arrive, gap = state baseline +
 * deterministic per-district variation.
 */
export function enrichDistricts(
  capability: CapabilityId,
): GeoJSON.FeatureCollection {
  if (!districtsCache) return EMPTY_FC;
  const stateGaps = computeStateGaps(capability);
  const fc = JSON.parse(
    JSON.stringify(districtsCache),
  ) as GeoJSON.FeatureCollection;
  fc.features.forEach((f) => {
    const raw = (f.properties ?? {}) as Record<string, unknown>;
    const stateName = String(raw.NAME_1 ?? "");
    const districtName = String(raw.NAME_2 ?? "");
    const meta = findStateMeta(stateName);
    const stateId = meta?.id ?? "";
    const baseGap = stateId ? stateGaps[stateId] ?? 0.5 : 0.5;
    const gap = Math.max(0, Math.min(1, baseGap + pseudoVariation(districtName)));
    f.properties = {
      id: `${stateId}-${districtName.replace(/\s+/g, "").slice(0, 4).toUpperCase()}`,
      name: districtName,
      state: meta?.name ?? stateName,
      stateId,
      gap,
      gapAdj: gap,
    };
  });
  return fc;
}

/**
 * Returns the 50 hand-curated "best-data" district point markers. Different
 * source from enrichDistricts() — these are the cities we have rich demo
 * facility data for, rendered as labelled dots on top of the choropleth.
 */
export function enrichDistrictPoints(
  capability: CapabilityId,
): GeoJSON.FeatureCollection {
  const bias = CAP_BIAS[capability] || {};
  const features: GeoJSON.Feature[] = DISTRICTS_GEO.map((d) => {
    const stateId = STATE_ID_OF[d.state];
    const b = (stateId && bias[stateId]) || 1;
    const gapAdj = Math.max(0, Math.min(1, d.gap * b));
    return {
      type: "Feature",
      properties: {
        id: d.id,
        name: d.name,
        state: d.state,
        stateId,
        pop: d.pop,
        facs: d.facs,
        verified: d.verified,
        gap: d.gap,
        gapAdj,
      },
      geometry: { type: "Point", coordinates: [d.lng, d.lat] },
    };
  });
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// setupLayers — registers sources, images, and layers on a loaded map.
// ---------------------------------------------------------------------------

export interface SetupLayersOptions {
  /** District id to highlight initially (e.g. "MZN" — one of DISTRICTS_GEO). */
  initialDistrictId: string;
}

/**
 * Add all Atlas sources, images, and layers to a fully-loaded MapLibre map.
 * loadIndiaGeo() MUST have resolved before this runs.
 *
 * Layer z-order (bottom → top):
 *   [basemap roads/water] · state-fill · state-line · state-highlight ·
 *   state-desert-line · district-poly-fill · district-poly-line ·
 *   [basemap labels] ·
 *   district-circle · district-selected · district-label · state-label
 */
export function setupLayers(map: MLMap, opts: SetupLayersOptions): void {
  const initialDistrictId = opts.initialDistrictId;

  // Insert custom fills/lines below the basemap's first symbol (city labels)
  // so the basemap remains legible above the choropleth.
  const firstSymbolId = map
    .getStyle()
    .layers?.find((l) => l.type === "symbol")?.id;

  // -- Sources --
  map.addSource("states", {
    type: "geojson",
    data: enrichStates("emergency"),
  });
  map.addSource("districts-poly", {
    type: "geojson",
    data: enrichDistricts("emergency"),
  });
  map.addSource("districts", {
    type: "geojson",
    data: enrichDistrictPoints("emergency"),
  });
  map.addSource("state-centroids", {
    type: "geojson",
    data: stateCentroidsCache ?? EMPTY_FC,
  });

  // -- State fills (choropleth) — fades out as we zoom in past districts. --
  map.addLayer(
    {
      id: "state-fill",
      type: "fill",
      source: "states",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "gap"],
          0.0, "#1A6B4A",
          0.3, "#34C58A",
          0.5, "#8AB07A",
          0.65, "#BFA46A",
          0.8, "#C07D4A",
          1.0, "#C04A3F",
        ],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3, 0.5,
          5, 0.45,
          6, 0.15,
          7, 0.0,
        ],
      },
    },
    firstSymbolId,
  );

  // -- State borders --
  map.addLayer(
    {
      id: "state-line",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#0B1417",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          3, 0.5, 6, 1.2, 9, 2,
        ],
        "line-opacity": 0.85,
      },
    },
    firstSymbolId,
  );

  // -- State hover highlight (controlled via setPaintProperty) --
  map.addLayer(
    {
      id: "state-highlight",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#BFA46A",
        "line-width": 2.5,
        "line-opacity": 0,
      },
    },
    firstSymbolId,
  );

  // -- Severe-gap dashed outline (filtered to gap >= 0.65) --
  map.addLayer(
    {
      id: "state-desert-line",
      type: "line",
      source: "states",
      filter: [">=", ["get", "gap"], 0.65],
      paint: {
        "line-color": "#C04A3F",
        "line-width": 1.5,
        "line-dasharray": [2, 3],
        "line-opacity": 0.5,
      },
    },
    firstSymbolId,
  );

  // -- District polygons fill (choropleth — fades in as state-fill fades out) --
  map.addLayer(
    {
      id: "district-poly-fill",
      type: "fill",
      source: "districts-poly",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "gap"],
          0.0, "#1A6B4A",
          0.3, "#34C58A",
          0.5, "#8AB07A",
          0.65, "#BFA46A",
          0.8, "#C07D4A",
          1.0, "#C04A3F",
        ],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 0.0,
          6, 0.35,
          9, 0.5,
        ],
      },
    },
    firstSymbolId,
  );

  // -- District polygon outlines --
  map.addLayer(
    {
      id: "district-poly-line",
      type: "line",
      source: "districts-poly",
      paint: {
        "line-color": "rgba(11, 20, 23, 0.6)",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          5, 0.2, 7, 0.5, 9, 1.0,
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          5, 0, 6, 0.6, 9, 0.8,
        ],
      },
    },
    firstSymbolId,
  );

  // -- Generate dot images for the 50-point markers --
  const makeCircle = (
    size: number,
    color: string,
    strokeColor: string,
    strokeWidth: number,
  ): { width: number; height: number; data: Uint8Array | Uint8ClampedArray } => {
    const r = size + strokeWidth;
    const d = r * 2;
    const canvas = document.createElement("canvas");
    canvas.width = d;
    canvas.height = d;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { width: d, height: d, data: new Uint8ClampedArray(d * d * 4) };
    }
    ctx.beginPath();
    ctx.arc(r, r, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (strokeWidth) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
    return {
      width: d,
      height: d,
      data: ctx.getImageData(0, 0, d, d).data,
    };
  };

  const dotColors: Array<{ id: string; c: string }> = [
    { id: "dot-green", c: "#34C58A" },
    { id: "dot-amber", c: "#BFA46A" },
    { id: "dot-orange", c: "#C07D4A" },
    { id: "dot-red", c: "#C04A3F" },
  ];
  dotColors.forEach(({ id, c }) => {
    map.addImage(id, makeCircle(8, c, "#0B1417", 2));
  });
  map.addImage("dot-selected", makeCircle(12, "transparent", "#BFA46A", 3));

  // -- 50-point district markers (top of stack — drawn over everything) --
  map.addLayer({
    id: "district-circle",
    type: "symbol",
    source: "districts",
    layout: {
      "icon-image": [
        "step",
        ["get", "gapAdj"],
        "dot-green", 0.4,
        "dot-amber", 0.7,
        "dot-orange", 0.85,
        "dot-red",
      ],
      "icon-size": [
        "interpolate", ["linear"], ["get", "facs"],
        4, 0.4, 50, 0.7, 150, 1.0, 320, 1.5,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // -- Selected-district highlight ring --
  map.addLayer({
    id: "district-selected",
    type: "symbol",
    source: "districts",
    filter: ["==", ["get", "id"], initialDistrictId],
    layout: {
      "icon-image": "dot-selected",
      "icon-size": [
        "interpolate", ["linear"], ["get", "facs"],
        4, 0.7, 50, 1.0, 150, 1.4, 320, 1.8,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // -- District labels (50 demo points only) --
  map.addLayer({
    id: "district-label",
    type: "symbol",
    source: "districts",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 7, 13],
      "text-offset": [0, 1.6],
      "text-anchor": "top",
      "text-optional": true,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "rgba(245, 241, 234, 0.85)",
      "text-halo-color": "#0B1417",
      "text-halo-width": 1.5,
    },
  });

  // -- State labels (centroids of real polygons) --
  map.addLayer({
    id: "state-label",
    type: "symbol",
    source: "state-centroids",
    minzoom: 3.5,
    maxzoom: 8,
    layout: {
      "text-field": [
        "step", ["zoom"],
        ["get", "abbr"],
        5.5,
        ["get", "name"],
      ],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate", ["linear"], ["zoom"],
        3.5, 9, 5, 11, 7, 14,
      ],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.12,
      "text-allow-overlap": false,
      "text-optional": true,
      "text-padding": 8,
    },
    paint: {
      "text-color": "rgba(245, 241, 234, 0.55)",
      "text-halo-color": "rgba(11, 20, 23, 0.9)",
      "text-halo-width": 1.2,
    },
  });
}
