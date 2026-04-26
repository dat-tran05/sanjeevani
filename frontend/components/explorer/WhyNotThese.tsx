"use client";

import { useState } from "react";
import { EXCLUSIONS } from "@/lib/demo/exclusions";

export function WhyNotThese() {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="wnt" data-open={open}>
      <div className="wnt-head" onClick={() => setOpen(!open)}>
        <div>
          <h4>Why not these?</h4>
          <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
            Six facilities considered and excluded · planner-auditable
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="count">6 excluded</span>
          <svg className="chev" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      <div className="wnt-list">
        {EXCLUSIONS.map((e, i) => (
          <div key={i} className="wnt-row">
            <div>
              <div className="name">{e.name}</div>
              <div className="meta-line">
                {e.district} · {e.type}
              </div>
            </div>
            <div className="reason">
              <strong>Excluded:</strong> {e.reason}
            </div>
            <span className={"verdict " + (e.verdict === "partial" ? "partial" : "")}>
              {e.verdict}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
