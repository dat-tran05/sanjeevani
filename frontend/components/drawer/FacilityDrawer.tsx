"use client";

import { useDrawer } from "@/lib/hooks/use-drawer";
import { FACILITIES } from "@/lib/demo/facilities";
import { TrustBadge } from "@/components/trust/TrustBadge";
import { RawRowCollapse } from "./RawRowCollapse";

type Segment =
  | { type: "text"; text: string }
  | { type: "mark"; text: string; id: string };

export function FacilityDrawer() {
  const { facilityId, citationId, isOpen, closeDrawer } = useDrawer();
  const facility = facilityId ? FACILITIES[facilityId] : null;

  if (!facility) {
    return (
      <>
        <div
          className={"drawer-overlay" + (isOpen ? " open" : "")}
          onClick={closeDrawer}
        />
        <div className={"drawer" + (isOpen ? " open" : "")} />
      </>
    );
  }

  const dims = [
    { lbl: "Existence", val: facility.trust.existence, max: 3 },
    { lbl: "Coherence", val: facility.trust.coherence, max: 3 },
    { lbl: "Recency", val: facility.trust.recency, max: 3 },
    { lbl: "Specificity", val: facility.trust.specificity, max: 3 },
  ] as const;

  const desc = facility.description;
  const sortedCits = [...facility.citations].sort(
    (a, b) => a.char_start - b.char_start
  );
  const segments: Segment[] = [];
  let cur = 0;
  sortedCits.forEach((c) => {
    if (c.char_start > cur) {
      segments.push({ type: "text", text: desc.slice(cur, c.char_start) });
    }
    segments.push({
      type: "mark",
      text: desc.slice(c.char_start, c.char_end),
      id: c.id,
    });
    cur = c.char_end;
  });
  if (cur < desc.length) {
    segments.push({ type: "text", text: desc.slice(cur) });
  }

  return (
    <>
      <div
        className={"drawer-overlay" + (isOpen ? " open" : "")}
        onClick={closeDrawer}
      />
      <div className={"drawer" + (isOpen ? " open" : "")}>
        <div className="drawer-head">
          <button
            className="drawer-close"
            onClick={closeDrawer}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="drawer-eyebrow">
            <span>Facility profile</span>
            <span className="id">· {facility.id}</span>
          </div>
          <h2>{facility.name}</h2>
          <div className="meta">
            <span>{facility.type}</span>
            <span style={{ color: "var(--fg-mute)" }}>·</span>
            <span>
              {facility.district}, {facility.state}
            </span>
            {facility.distance_km ? (
              <>
                <span style={{ color: "var(--fg-mute)" }}>·</span>
                <span style={{ fontFamily: "var(--mono)" }}>
                  {facility.distance_km.toFixed(1)}km
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="drawer-body">
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Trust badge · 4 dimensions</span>
              <span className="line"></span>
            </div>
            <div className="trust-detail">
              <TrustBadge trust={facility.trust} size="lg" showLabel />
              <div className="trust-dim-list">
                {dims.map((d) => (
                  <div key={d.lbl} className="trust-dim-row">
                    <span className="lbl">{d.lbl}</span>
                    <div className="bar">
                      <div
                        className="fill"
                        style={{ width: `${(d.val / d.max) * 100}%` }}
                      />
                    </div>
                    <span className="num">
                      {d.val}/{d.max}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Capability verdicts · jury</span>
              <span className="line"></span>
            </div>
            <div className="capabilities-grid">
              {facility.capabilities.map((c, i) => (
                <div key={i} className="cap-row">
                  <span className="cap-name">{c.name}</span>
                  <span className="agree">{c.agree}</span>
                  <span
                    className={
                      "jury-verdict-pill " +
                      (c.verdict === "supported" ? "" : c.verdict)
                    }
                  >
                    {c.verdict}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Description · citations highlighted</span>
              <span className="line"></span>
            </div>
            <div className="description-block">
              {segments.map((s, i) =>
                s.type === "mark" ? (
                  <mark
                    key={i}
                    className={s.id === citationId ? "spotlight" : ""}
                  >
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                )
              )}
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Raw row · delta.silver.facilities</span>
              <span className="line"></span>
            </div>
            <RawRowCollapse facility={facility} />
          </div>
        </div>
      </div>
    </>
  );
}
