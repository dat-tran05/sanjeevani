"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { MapFacility } from "@/lib/types";

const FACILITY_COLOR: [number, number, number, number] = [148, 188, 122, 220];
const VERIFIED_COLOR: [number, number, number, number] = [212, 164, 106, 230];

export function SplashVisual() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (mapRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [82, 22],
      zoom: 3.5,
      minZoom: 3.2,
      maxZoom: 5,
      maxBounds: [
        [58, 2],
        [102, 40],
      ],
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      interactive: false,
    });

    map.on("load", async () => {
      try {
        const res = await fetch("/facilities.min.json");
        const facilities = (await res.json()) as MapFacility[];
        // Down-sample for splash density (full 10k overwhelms the small canvas).
        const stride = Math.max(1, Math.ceil(facilities.length / 1800));
        const sample = facilities.filter((_, i) => i % stride === 0);
        const overlay = new MapboxOverlay({
          interleaved: true,
          layers: [
            new ScatterplotLayer<MapFacility>({
              id: "splash-pins",
              data: sample,
              getPosition: (f) => [f.lng, f.lat],
              getRadius: 1200,
              radiusUnits: "meters",
              radiusMinPixels: 1.2,
              radiusMaxPixels: 3.5,
              getFillColor: (f) =>
                f.verified ? VERIFIED_COLOR : FACILITY_COLOR,
              stroked: false,
              opacity: 0.9,
            }),
          ],
        });
        map.addControl(overlay);
      } catch (err) {
        console.warn("[splash] failed to load facility pins", err);
      }
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="splash-visual">
      <div className="corner-mark">India · 10,053 indexed</div>
      <div ref={containerRef} className="splash-map" />
      <div className="splash-target" aria-hidden="true">
        <div className="ring" />
        <div className="dot" />
      </div>
    </div>
  );
}
