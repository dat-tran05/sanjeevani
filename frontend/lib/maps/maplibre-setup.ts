// Source/layer factories for the Atlas MapLibre instance.
// Pure TypeScript — no runtime maplibregl import here so this module is safe to
// import from server components. Live `new maplibregl.Map(...)` happens in
// components/atlas/AtlasMap.tsx, which calls setupLayers() once the map fires
// its 'load' event.
//
// Source: project/components-atlas.jsx
//   - GeoJSON builders: lines 7-31
//   - computeStateGaps:   lines 52-67
//   - enrichStates:       lines 88-94
//   - enrichDistricts:    lines 96-105
//   - addLayer body:      lines 135-327 (incl. makeCircle helper at 205-232)

import type { Map as MLMap } from "maplibre-gl";
import type { CapabilityId } from "@/lib/types";
import { STATES_GEO } from "@/lib/demo/states-geo";
import { DISTRICTS_GEO, STATE_ID_OF } from "@/lib/demo/districts-geo";
import { CAP_BIAS } from "@/lib/demo/capability-bias";
import { centroidLngLat } from "./geo-utils";

// ---------------------------------------------------------------------------
// GeoJSON builders
// ---------------------------------------------------------------------------

/**
 * Build a FeatureCollection of state polygons.
 * Closes each ring (first === last) and exposes id/name/abbr/capital as props.
 * Port of components-atlas.jsx:7-22.
 */
export function buildStatesGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = STATES_GEO.map((s) => {
    const rings = s.rings.map((ring) => {
      const r: Array<[number, number]> = [...ring];
      const first = r[0];
      const last = r[r.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        r.push([first[0], first[1]]);
      }
      return r;
    });
    return {
      type: "Feature",
      properties: { id: s.id, name: s.name, abbr: s.abbr, capital: s.capital },
      geometry: { type: "Polygon", coordinates: rings },
    };
  });
  return { type: "FeatureCollection", features };
}

/**
 * Build a FeatureCollection of district points.
 * Port of components-atlas.jsx:24-31.
 */
export function buildDistrictsGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = DISTRICTS_GEO.map((d) => ({
    type: "Feature",
    properties: {
      id: d.id,
      name: d.name,
      state: d.state,
      pop: d.pop,
      facs: d.facs,
      verified: d.verified,
      gap: d.gap,
    },
    geometry: { type: "Point", coordinates: [d.lng, d.lat] },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Build a FeatureCollection of state-centroid points used by the state-label
 * symbol layer. Port of components-atlas.jsx:294-304.
 */
export function buildStateCentroidsGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = STATES_GEO.map((s) => {
    const c = centroidLngLat(s.rings);
    return {
      type: "Feature",
      properties: { name: s.name, abbr: s.abbr, id: s.id },
      geometry: { type: "Point", coordinates: c },
    };
  });
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Per-capability gap aggregation
// ---------------------------------------------------------------------------

/**
 * Average each state's district .gap × the per-state CAP_BIAS multiplier.
 * Port of components-atlas.jsx:52-67.
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
      const avg =
        inState.reduce((a, d) => a + d.gap, 0) / inState.length;
      map[s.id] = Math.max(0, Math.min(1, avg * (bias[s.id] ?? 1)));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Enriched FeatureCollections (gap baked into properties for color interp)
// ---------------------------------------------------------------------------

/** Port of components-atlas.jsx:88-94 — bakes .gap onto each state feature. */
export function enrichStates(capability: CapabilityId): GeoJSON.FeatureCollection {
  const gaps = computeStateGaps(capability);
  const fc = JSON.parse(
    JSON.stringify(buildStatesGeoJSON()),
  ) as GeoJSON.FeatureCollection;
  fc.features.forEach((f) => {
    const id = (f.properties as { id?: string } | null)?.id;
    if (!f.properties) f.properties = {};
    (f.properties as Record<string, unknown>).gap =
      (id && gaps[id]) || 0.5;
  });
  return fc;
}

/** Port of components-atlas.jsx:96-105 — bakes .gapAdj onto each district. */
export function enrichDistricts(
  capability: CapabilityId,
): GeoJSON.FeatureCollection {
  const bias = CAP_BIAS[capability] || {};
  const fc = JSON.parse(
    JSON.stringify(buildDistrictsGeoJSON()),
  ) as GeoJSON.FeatureCollection;
  fc.features.forEach((f) => {
    const props = (f.properties || {}) as {
      state?: string;
      gap?: number;
    } & Record<string, unknown>;
    const stateId = props.state ? STATE_ID_OF[props.state] : undefined;
    const b = (stateId && bias[stateId]) || 1;
    const baseGap = typeof props.gap === "number" ? props.gap : 0;
    props.gapAdj = Math.max(0, Math.min(1, baseGap * b));
    f.properties = props;
  });
  return fc;
}

// ---------------------------------------------------------------------------
// setupLayers — registers sources, images, and layers on a loaded map.
// ---------------------------------------------------------------------------

export interface SetupLayersOptions {
  /** District id to highlight initially (e.g. "MZN"). */
  initialDistrictId: string;
}

/**
 * Add all Atlas sources, images, and layers to a fully-loaded MapLibre map.
 * Order matters — first added paints below. Port of the entire body of the
 * map.on('load', ...) handler in components-atlas.jsx:135-327.
 *
 * Layers added (in z-order, bottom → top):
 *   ocean-vignette · state-fill · state-line · state-highlight ·
 *   state-desert-line · district-circle · district-selected ·
 *   district-label · state-label
 */
export function setupLayers(map: MLMap, opts: SetupLayersOptions): void {
  const initialDistrictId = opts.initialDistrictId;

  // -- Sources (state polygons + district points) --
  // Capability is irrelevant for the initial bake — the AtlasMap effect that
  // depends on [capability] calls setData() with enrichStates/enrichDistricts
  // immediately on every change, including the first render.
  map.addSource("states", {
    type: "geojson",
    data: enrichStates("emergency"),
  });
  map.addSource("districts", {
    type: "geojson",
    data: enrichDistricts("emergency"),
  });

  // -- Ocean / vignette background (depth) --
  map.addLayer({
    id: "ocean-vignette",
    type: "background",
    paint: { "background-color": "#070D10" },
  });

  // -- State fills (choropleth) --
  map.addLayer({
    id: "state-fill",
    type: "fill",
    source: "states",
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "gap"],
        0.0,
        "#1A6B4A",
        0.3,
        "#34C58A",
        0.5,
        "#8AB07A",
        0.65,
        "#BFA46A",
        0.8,
        "#C07D4A",
        1.0,
        "#C04A3F",
      ],
      "fill-opacity": 0.72,
    },
  });

  // -- State borders --
  map.addLayer({
    id: "state-line",
    type: "line",
    source: "states",
    paint: {
      "line-color": "#1F2D32",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        0.5,
        6,
        1.2,
        9,
        2,
      ],
      "line-opacity": 0.8,
    },
  });

  // -- State hover highlight (controlled via setPaintProperty) --
  map.addLayer({
    id: "state-highlight",
    type: "line",
    source: "states",
    paint: {
      "line-color": "#BFA46A",
      "line-width": 2.5,
      "line-opacity": 0,
    },
  });

  // -- Severe-gap dashed outline (filtered to gap >= 0.65) --
  map.addLayer({
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
  });

  // -- Generate dot images (canvas → addImage) --
  // Port of components-atlas.jsx:205-232.
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
      // Fallback: empty pixel buffer of the right dimensions.
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
  map.addImage(
    "dot-selected",
    makeCircle(12, "transparent", "#BFA46A", 3),
  );

  // -- District markers (symbol layer using dot-* images) --
  map.addLayer({
    id: "district-circle",
    type: "symbol",
    source: "districts",
    layout: {
      "icon-image": [
        "step",
        ["get", "gapAdj"],
        "dot-green",
        0.4,
        "dot-amber",
        0.7,
        "dot-orange",
        0.85,
        "dot-red",
      ],
      "icon-size": [
        "interpolate",
        ["linear"],
        ["get", "facs"],
        4,
        0.4,
        50,
        0.7,
        150,
        1.0,
        320,
        1.5,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // -- Selected-district highlight ring (filtered to opts.initialDistrictId) --
  map.addLayer({
    id: "district-selected",
    type: "symbol",
    source: "districts",
    filter: ["==", ["get", "id"], initialDistrictId],
    layout: {
      "icon-image": "dot-selected",
      "icon-size": [
        "interpolate",
        ["linear"],
        ["get", "facs"],
        4,
        0.7,
        50,
        1.0,
        150,
        1.4,
        320,
        1.8,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // -- District labels --
  map.addLayer({
    id: "district-label",
    type: "symbol",
    source: "districts",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        10,
        7,
        13,
      ],
      "text-offset": [0, 1.6],
      "text-anchor": "top",
      "text-optional": true,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "rgba(245, 241, 234, 0.75)",
      "text-halo-color": "#0B1417",
      "text-halo-width": 1.5,
    },
  });

  // -- State labels (uses centroid source) --
  map.addSource("state-centroids", {
    type: "geojson",
    data: buildStateCentroidsGeoJSON(),
  });
  map.addLayer({
    id: "state-label",
    type: "symbol",
    source: "state-centroids",
    minzoom: 3.5,
    maxzoom: 8,
    layout: {
      "text-field": [
        "step",
        ["zoom"],
        ["get", "abbr"],
        5.5,
        ["get", "name"],
      ],
      "text-font": ["Open Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3.5,
        9,
        5,
        11,
        7,
        14,
      ],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.12,
      "text-allow-overlap": false,
      "text-optional": true,
      "text-padding": 8,
    },
    paint: {
      "text-color": "rgba(245, 241, 234, 0.45)",
      "text-halo-color": "rgba(11, 20, 23, 0.8)",
      "text-halo-width": 1,
    },
  });
}
