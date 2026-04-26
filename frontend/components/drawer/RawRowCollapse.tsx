"use client";

import { useState } from "react";
import type { RecommendedFacility } from "@/lib/types";

interface RawRowCollapseProps {
  facility: RecommendedFacility;
}

export function RawRowCollapse({ facility }: RawRowCollapseProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="raw-collapse" data-open={open}>
      <div className="raw-head" onClick={() => setOpen(!open)}>
        <span>{open ? "Hide" : "Show"} 41 columns</span>
        <span
          style={{
            fontFamily: "var(--sans)",
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--fg-mute)",
          }}
        >
          {open ? "▴" : "▾"}
        </span>
      </div>
      <div className="raw-content">
        facility_id: {facility.id}
        <br />
        name: &quot;{facility.name}&quot;
        <br />
        type: &quot;{facility.type}&quot;
        <br />
        state: &quot;{facility.state}&quot;
        <br />
        district: &quot;{facility.district}&quot;
        <br />
        latitude: {facility.latitude} · longitude: {facility.longitude}
        <br />
        description_len: {facility.description.length} chars
        <br />
        trust.score: {facility.trust.score.toFixed(3)}
        <br />
        <span style={{ color: "var(--fg-mute)" }}>· · · 32 more columns</span>
      </div>
    </div>
  );
}
