"use client";

// AtlasMap — wraps MapLibre. Owns map lifecycle (init/teardown), wires the
// hover/click/leave handlers, and reacts to capability + layer prop changes.
// All durable state (capability, selectedDistrictId, focusedState, hoverInfo)
// lives on the parent atlas page (Task 26); this component is purely
// controlled.
//
// Source: project/components-atlas.jsx:72-404 (the Atlas function up to its
// JSX return, minus the chrome — segmented selector, search, layers panel,
// legend, breadcrumb, tooltip, drilldown — which all live in sibling
// components).

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";

import type { CapabilityId, MapFacility } from "@/lib/types";
import { DISTRICTS_GEO, STATE_ID_OF } from "@/lib/demo/districts-geo";
import {
  enrichDistrictPoints,
  enrichDistricts,
  enrichStates,
  loadIndiaGeo,
  setupLayers,
} from "@/lib/maps/maplibre-setup";
import { useDrawer } from "@/lib/hooks/use-drawer";

const FACILITY_COLOR_BY_TYPE: Record<string, [number, number, number, number]> = {
  hospital: [212, 164, 106, 230], // gold/amber — high-acuity
  clinic:   [148, 188, 122, 200], // green
  dentist:  [192, 125, 74, 200],  // orange
  doctor:   [180, 180, 180, 200], // gray
  pharmacy: [120, 130, 140, 180], // muted
  other:    [120, 130, 140, 180],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoverInfo {
  /** Pixel position in the map canvas — used by AtlasTooltip for placement. */
  x: number;
  y: number;
  kind: "state" | "district";
  name: string;
  // state-only
  capital?: string;
  districts?: number;
  // either
  facs: number;
  verified: number;
  gap: number;
  state?: string;
}

export interface AtlasLayerToggles {
  choropleth: boolean;
  pins: boolean;
  labels: boolean;
  deserts: boolean;
}

export interface AtlasMapProps {
  capability: CapabilityId;
  selectedDistrictId: string;
  onDistrictSelect: (districtId: string) => void;
  onStateFocus: (stateId: string | null) => void;
  onHover: (info: HoverInfo | null) => void;
  layers: AtlasLayerToggles;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AtlasMap({
  capability,
  selectedDistrictId,
  onDistrictSelect,
  onStateFocus,
  onHover,
  layers,
}: AtlasMapProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const { openDrawer } = useDrawer();

  // Latest-callback refs so the map's load handler never closes over stale
  // props. Updated on every render.
  const onHoverRef = useRef(onHover);
  const onDistrictSelectRef = useRef(onDistrictSelect);
  const onStateFocusRef = useRef(onStateFocus);
  const openDrawerRef = useRef(openDrawer);
  useEffect(() => {
    onHoverRef.current = onHover;
    onDistrictSelectRef.current = onDistrictSelect;
    onStateFocusRef.current = onStateFocus;
    openDrawerRef.current = openDrawer;
  });

  // -------------------------------------------------------------------------
  // Effect 1 — initialize the map exactly once on mount.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (mapRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      // OpenFreeMap dark — vector basemap with land/water/roads/labels.
      // No API key, MapLibre-native, ships Noto fonts via its glyphs URL.
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [80, 22],
      zoom: 4.0,
      minZoom: 3.2,
      maxZoom: 9,
      maxBounds: [
        [58, 2],
        [102, 40],
      ],
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    });

    map.on("load", async () => {
      // Real Datameet/GADM polygons must be in the module-level cache before
      // setupLayers wires them into sources.
      await loadIndiaGeo();
      setupLayers(map, { initialDistrictId: selectedDistrictId });

      // ---- Facility pins (deck.gl ScatterplotLayer over 10k facilities) ----
      try {
        const res = await fetch("/facilities.min.json");
        const facilities = (await res.json()) as MapFacility[];
        const overlay = new MapboxOverlay({
          interleaved: true,
          layers: [
            new ScatterplotLayer<MapFacility>({
              id: "facility-pins",
              data: facilities,
              getPosition: (f: MapFacility) => [f.lng, f.lat],
              getRadius: 1500,
              radiusUnits: "meters",
              radiusMinPixels: 1.5,
              radiusMaxPixels: 6,
              stroked: true,
              lineWidthMinPixels: 0.5,
              getLineColor: [11, 20, 23, 220],
              getFillColor: (f: MapFacility) =>
                FACILITY_COLOR_BY_TYPE[f.type] ?? FACILITY_COLOR_BY_TYPE.other,
              pickable: true,
              autoHighlight: true,
              highlightColor: [212, 164, 106, 240],
              onClick: (info: PickingInfo<MapFacility>) => {
                if (info.object) {
                  openDrawerRef.current(info.object.id);
                }
              },
            }),
          ],
        });
        map.addControl(overlay);
      } catch (err) {
        console.warn("[atlas] failed to load facility pins", err);
      }

      // ---- State hover ----
      map.on("mousemove", "state-fill", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const props = f.properties as {
          id: string;
          name: string;
          capital: string;
          gap: number;
        };
        const sId = props.id;
        // Toggle highlight outline for the hovered state only.
        map.setPaintProperty("state-highlight", "line-opacity", [
          "case",
          ["==", ["get", "id"], sId],
          0.8,
          0,
        ]);
        const districts = DISTRICTS_GEO.filter(
          (d) => STATE_ID_OF[d.state] === sId,
        );
        const totalFacs = districts.reduce((a, d) => a + d.facs, 0);
        const totalVer = districts.reduce((a, d) => a + d.verified, 0);
        onHoverRef.current({
          x: e.point.x,
          y: e.point.y,
          kind: "state",
          name: props.name,
          capital: props.capital,
          gap: props.gap,
          facs: totalFacs,
          verified: totalVer,
          districts: districts.length,
        });
      });

      map.on("mouseleave", "state-fill", () => {
        map.getCanvas().style.cursor = "";
        map.setPaintProperty("state-highlight", "line-opacity", 0);
        onHoverRef.current(null);
      });

      // ---- District hover ----
      map.on("mousemove", "district-circle", (e: MapLayerMouseEvent) => {
        e.originalEvent.stopPropagation();
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const props = f.properties as {
          name: string;
          state: string;
          gap: number;
          gapAdj?: number;
          facs: number;
          verified: number;
        };
        onHoverRef.current({
          x: e.point.x,
          y: e.point.y,
          kind: "district",
          name: props.name,
          state: props.state,
          gap: props.gapAdj ?? props.gap,
          facs: props.facs,
          verified: props.verified,
        });
      });

      map.on("mouseleave", "district-circle", () => {
        map.getCanvas().style.cursor = "";
        onHoverRef.current(null);
      });

      // ---- State click → notify parent for fly-to / focus ----
      map.on("click", "state-fill", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const sId = (f.properties as { id: string }).id;
        // Auto-select the first district in this state, mirroring the
        // reference Atlas behavior (components-atlas.jsx:382-386).
        const inState = DISTRICTS_GEO.filter(
          (d) => STATE_ID_OF[d.state] === sId,
        );
        if (inState.length) {
          const first = inState[0];
          onDistrictSelectRef.current(first.id);
          map.setFilter("district-selected", [
            "==",
            ["get", "id"],
            first.id,
          ]);
        }
        onStateFocusRef.current(sId);
      });

      // ---- District click → notify parent ----
      map.on("click", "district-circle", (e: MapLayerMouseEvent) => {
        e.originalEvent.stopPropagation();
        const f = e.features?.[0];
        if (!f) return;
        const id = (f.properties as { id: string }).id;
        onDistrictSelectRef.current(id);
        map.setFilter("district-selected", ["==", ["get", "id"], id]);
      });
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // We intentionally only init once. selectedDistrictId is consumed by
    // setupLayers via the initial filter; subsequent changes flow through
    // the click handlers (which call setFilter) and the parent prop loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Effect 2 — re-bake source data when capability changes.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      try {
        const sSrc = map.getSource("states") as GeoJSONSource | undefined;
        sSrc?.setData(enrichStates(capability));
        const dpSrc = map.getSource("districts-poly") as GeoJSONSource | undefined;
        dpSrc?.setData(enrichDistricts(capability));
        const dSrc = map.getSource("districts") as GeoJSONSource | undefined;
        dSrc?.setData(enrichDistrictPoints(capability));
      } catch {
        // Ignore — map may not be styled yet.
      }
    };
    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [capability]);

  // -------------------------------------------------------------------------
  // Effect 3 — toggle layer visibility on prop changes.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (v: boolean): "visible" | "none" => (v ? "visible" : "none");
    try {
      map.setLayoutProperty("state-fill", "visibility", vis(layers.choropleth));
      map.setLayoutProperty(
        "district-poly-fill",
        "visibility",
        vis(layers.choropleth),
      );
      map.setLayoutProperty(
        "district-poly-line",
        "visibility",
        vis(layers.choropleth),
      );
      map.setLayoutProperty(
        "state-desert-line",
        "visibility",
        vis(layers.choropleth && layers.deserts),
      );
      map.setLayoutProperty("district-circle", "visibility", vis(layers.pins));
      map.setLayoutProperty("district-selected", "visibility", vis(layers.pins));
      map.setLayoutProperty("district-label", "visibility", vis(layers.labels));
      map.setLayoutProperty("state-label", "visibility", vis(layers.labels));
    } catch {
      // Layers may not be added yet — first 'load' will run effect 2 next.
    }
  }, [layers]);

  // -------------------------------------------------------------------------
  // Effect 4 — keep the selected-district filter in sync if the parent
  // mutates selectedDistrictId outside of our click handlers (e.g. the
  // search or breadcrumb-driven flyTo on the parent page).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      map.setFilter("district-selected", [
        "==",
        ["get", "id"],
        selectedDistrictId,
      ]);
    } catch {
      // Layer may not exist yet.
    }
  }, [selectedDistrictId]);

  return <div ref={containerRef} className="atlas-map-container" />;
}
