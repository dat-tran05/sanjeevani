"use client";

import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import type { CapabilityId, DistrictPoint, StateGeo } from "@/lib/types";
import { CapabilitySegmented } from "@/components/atlas/CapabilitySegmented";
import { LayerToggles } from "@/components/atlas/LayerToggles";
import { AtlasSearch } from "@/components/atlas/AtlasSearch";
import { AtlasLegend } from "@/components/atlas/AtlasLegend";
import { AtlasBreadcrumb } from "@/components/atlas/AtlasBreadcrumb";
import { AtlasTooltip } from "@/components/atlas/AtlasTooltip";
import { DistrictDrillDown } from "@/components/atlas/DistrictDrillDown";
import { DISTRICTS_GEO } from "@/lib/demo/districts-geo";

const AtlasMap = dynamic(
  () => import("@/components/atlas/AtlasMap").then((m) => m.AtlasMap),
  { ssr: false, loading: () => <div className="atlas-map-container" /> }
);

interface HoverInfo {
  x: number;
  y: number;
  kind: "state" | "district";
  name: string;
  capital?: string;
  districts?: number;
  state?: string;
  facs: number;
  verified: number;
  gap: number;
}

interface LayerState {
  choropleth: boolean;
  pins: boolean;
  labels: boolean;
  deserts: boolean;
}

const INITIAL_LAYERS: LayerState = {
  choropleth: true,
  pins: true,
  labels: true,
  deserts: true,
};

function AtlasInner() {
  const [capability, setCapability] = useState<CapabilityId>("emergency");
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>("MZN");
  const [focusedState, setFocusedState] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>(INITIAL_LAYERS);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const selDistrict: DistrictPoint =
    DISTRICTS_GEO.find((d) => d.id === selectedDistrictId) ?? DISTRICTS_GEO[0]!;

  const handlePickDistrict = (district: DistrictPoint) => {
    setSelectedDistrictId(district.id);
    // (Camera fly-to not yet wired — see docs/sse-event-contract.md atlas REST notes.)
  };

  const handlePickState = (state: StateGeo) => {
    setFocusedState(state.id);
  };

  return (
    <div className="atlas">
      <div className="atlas-stage">
        <AtlasMap
          capability={capability}
          selectedDistrictId={selectedDistrictId}
          onDistrictSelect={setSelectedDistrictId}
          onStateFocus={setFocusedState}
          onHover={setHover}
          layers={layers}
        />
        <div className="atlas-controls">
          <CapabilitySegmented value={capability} onChange={setCapability} />
        </div>
        <div className="atlas-rightcol">
          <AtlasSearch
            onPickDistrict={handlePickDistrict}
            onPickState={handlePickState}
          />
          <LayerToggles value={layers} onChange={setLayers} />
        </div>
        <AtlasLegend capability={capability} />
        {focusedState && (
          <AtlasBreadcrumb
            stateId={focusedState}
            onReset={() => setFocusedState(null)}
          />
        )}
        {hover && <AtlasTooltip {...hover} />}
      </div>
      <DistrictDrillDown district={selDistrict} capability={capability} />
    </div>
  );
}

export default function AtlasPage() {
  return (
    <Suspense fallback={<div className="atlas" />}>
      <AtlasInner />
    </Suspense>
  );
}
