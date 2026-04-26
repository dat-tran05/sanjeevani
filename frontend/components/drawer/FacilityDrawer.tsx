"use client";

import { useDrawer } from "@/lib/hooks/use-drawer";
import { useFacility } from "@/lib/hooks/use-facility";
import { TrustBadge } from "@/components/trust/TrustBadge";

type Segment =
  | { type: "text"; text: string }
  | { type: "mark"; text: string; id: string };

/** Truncates "F-XXXXXXXX..." to "F-XXXX…XXXX" with full text on hover. */
function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  const MAX = 12;
  const visible = items.slice(0, MAX);
  const overflow = items.length - visible.length;
  return (
    <div className="chip-list">
      <div className="chip-list-label">{label}</div>
      <div className="chip-list-items">
        {visible.map((s, i) => (
          <span key={i} className="chip">
            {s}
          </span>
        ))}
        {overflow > 0 && <span className="chip chip-more">+{overflow} more</span>}
      </div>
    </div>
  );
}

export function FacilityDrawer() {
  const { facilityId, citationId, isOpen, closeDrawer } = useDrawer();
  const { facility } = useFacility(facilityId);

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

  // The citation the user clicked (if any) — promoted to a focused panel
  // above the rest of the description so the source quote + facility context
  // is the FIRST thing they see.
  const focusedCit = citationId
    ? facility.citations.find((c) => c.id === citationId)
    : null;

  const hasCapabilities = facility.capabilities.length > 0;
  const specialties = facility.specialties ?? [];
  const procedures = facility.procedures ?? [];
  const equipment = facility.equipment ?? [];
  const surgeryFlag = facility.surgery_capable;
  const emergencyFlag = facility.emergency_24_7;
  const hasFlags = surgeryFlag != null || emergencyFlag != null;
  const hasExtracted =
    specialties.length > 0 ||
    procedures.length > 0 ||
    equipment.length > 0 ||
    hasFlags;

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
            <span className="id" title={facility.id}>· {shortId(facility.id)}</span>
          </div>
          <h2>{facility.name}</h2>
          <div className="meta">
            <span>{facility.type}</span>
            <span style={{ color: "var(--fg-mute)" }}>·</span>
            <span>
              {facility.district}{facility.district && facility.state ? ", " : ""}{facility.state}
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
          {focusedCit && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                <span className="label" style={{ color: "var(--gold)" }}>
                  Citation evidence · source quote
                </span>
                <span className="line"></span>
              </div>
              <div
                style={{
                  background: "var(--gold-glow)",
                  border: "1px solid rgba(212, 166, 97, 0.3)",
                  borderRadius: 8,
                  padding: "16px 18px",
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: "var(--fg)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--fg-mute)",
                    marginBottom: 8,
                  }}
                >
                  Field: {focusedCit.column} · chars {focusedCit.char_start}–{focusedCit.char_end}
                </div>
                <div style={{ fontStyle: "italic" }}>&ldquo;{focusedCit.text}&rdquo;</div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(212, 166, 97, 0.2)",
                    fontSize: 13,
                    color: "var(--fg-2)",
                  }}
                >
                  This excerpt is the verbatim source text the agent used to
                  back its claim about <strong>{facility.name}</strong>. The
                  full context is highlighted in gold below.
                </div>
              </div>
            </div>
          )}
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
          {hasExtracted && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                <span className="label">Capabilities & specialties</span>
                <span className="line"></span>
              </div>
              {hasFlags && (
                <div className="cap-flags">
                  {surgeryFlag != null && (
                    <span className={"cap-flag" + (surgeryFlag ? " on" : " off")}>
                      {surgeryFlag ? "✓" : "✕"} Surgery capable
                    </span>
                  )}
                  {emergencyFlag != null && (
                    <span className={"cap-flag" + (emergencyFlag ? " on" : " off")}>
                      {emergencyFlag ? "✓" : "✕"} 24/7 Emergency
                    </span>
                  )}
                </div>
              )}
              {specialties.length > 0 && (
                <ChipList label="Specialties" items={specialties} />
              )}
              {procedures.length > 0 && (
                <ChipList label="Procedures" items={procedures} />
              )}
              {equipment.length > 0 && (
                <ChipList label="Equipment" items={equipment} />
              )}
            </div>
          )}
          {hasCapabilities && (
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
          )}
          {desc && (
            <div className="drawer-section">
              <div className="drawer-section-h">
                <span className="label">Description · citations highlighted</span>
                <span className="line"></span>
              </div>
              <div className="description-block">
                {segments.length === 0 ? (
                  <span>{desc}</span>
                ) : (
                  segments.map((s, i) =>
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
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
