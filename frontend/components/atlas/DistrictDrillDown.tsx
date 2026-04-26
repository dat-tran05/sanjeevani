"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CapabilityId, DistrictPoint, FacilityTrust } from "@/lib/types";
import { CAPABILITIES } from "@/lib/demo/capability-bias";
import { TrustBadge } from "@/components/trust/TrustBadge";
import { useDrawer } from "@/lib/hooks/use-drawer";

interface DistrictDrillDownProps {
  district: DistrictPoint;
  capability: CapabilityId;
}

interface BestFacility {
  id: string;
  name: string;
  type: string;
  lat: number | null;
  lon: number | null;
  trust_badge: {
    existence: number;
    coherence: number;
    recency: number;
    specificity: number;
  } | null;
  matches_capability: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function distanceKm(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Backend stores trust dimensions as 0–1 floats; UI badge uses 0–3 ordinal.
function clampDim(n: number | null | undefined): 0 | 1 | 2 | 3 {
  if (n == null) return 0;
  return Math.round(Math.max(0, Math.min(3, n * 3))) as 0 | 1 | 2 | 3;
}

function trustFromBadge(b: BestFacility["trust_badge"]): FacilityTrust {
  if (!b) return { existence: 0, coherence: 0, recency: 0, specificity: 0, score: 0 };
  const e = clampDim(b.existence);
  const c = clampDim(b.coherence);
  const r = clampDim(b.recency);
  const s = clampDim(b.specificity);
  return { existence: e, coherence: c, recency: r, specificity: s, score: (e + c + r + s) / 12 };
}

export function DistrictDrillDown({
  district,
  capability,
}: DistrictDrillDownProps) {
  const { openDrawer } = useDrawer();
  const capLabel =
    CAPABILITIES.find((c) => c.id === capability)?.label ?? "";

  const [best, setBest] = useState<BestFacility[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url =
      `${API_URL}/districts/best` +
      `?state=${encodeURIComponent(district.state)}` +
      `&city=${encodeURIComponent(district.name)}` +
      `&capability=${capability}` +
      `&limit=3`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { facilities: [] }))
      .then((data: { facilities?: BestFacility[] }) => {
        if (!cancelled) setBest(data.facilities ?? []);
      })
      .catch(() => {
        if (!cancelled) setBest([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [district.state, district.name, capability]);

  const gapWord =
    district.gap > 0.7
      ? "severe gap"
      : district.gap > 0.5
        ? "underserved"
        : district.gap > 0.3
          ? "moderate"
          : "well-served";

  const commentary =
    district.gap > 0.7
      ? `${district.name} sits in the top decile of capability gap. Most listed facilities lack equipment or procedure citations specific enough to verify ${capLabel.toLowerCase()}.`
      : `${district.name} carries reasonable verification density for ${capLabel.toLowerCase()}. Specificity is the limiting trust dimension.`;

  return (
    <div className="drilldown">
      <div className="drilldown-head">
        <div className="eyebrow">District drill-down · {capLabel}</div>
        <h3>{district.name}</h3>
        <div className="sub">
          {district.state} · est. pop. {(district.pop / 1e6).toFixed(2)}M
        </div>
      </div>
      <div className="drilldown-body">
        <div className="dd-stat">
          <span className="lbl">Facilities listed</span>
          <span className="val">{district.facs}</span>
        </div>
        <div className="dd-stat">
          <span className="lbl">Verified for {capLabel.toLowerCase()}</span>
          <span className={"val " + (district.gap > 0.6 ? "warn" : "ok")}>
            {district.verified}
          </span>
        </div>
        <div className="dd-stat">
          <span className="lbl">Pop. per verified facility</span>
          <span className={"val " + (district.gap > 0.6 ? "warn" : "")}>
            {Math.round(
              district.pop / Math.max(1, district.verified)
            ).toLocaleString()}
          </span>
        </div>
        <div className="dd-stat">
          <span className="lbl">Capability gap score</span>
          <span className={"val " + (district.gap > 0.6 ? "warn" : "ok")}>
            {district.gap.toFixed(2)}
          </span>
        </div>

        <div className="dd-section-h">Status</div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background:
              district.gap > 0.6
                ? "var(--crimson-glow)"
                : "var(--green-glow)",
            border:
              "1px solid " +
              (district.gap > 0.6
                ? "rgba(192,74,63,0.3)"
                : "rgba(43,182,115,0.3)"),
            borderRadius: 999,
            color: district.gap > 0.6 ? "var(--crimson)" : "var(--green)",
            fontSize: 12,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontWeight: 600,
          }}
        >
          {gapWord}
        </div>

        <div className="dd-commentary">{commentary}</div>

        <div className="dd-section-h">
          Best-trust facilities for {capLabel.toLowerCase()}
        </div>
        {loading && (
          <div className="dd-empty">Loading top facilities…</div>
        )}
        {!loading && best.length === 0 && (
          <div className="dd-empty">
            No facilities listed in {district.name} for {capLabel.toLowerCase()}.
          </div>
        )}
        {!loading &&
          best.map((f) => {
            const km =
              f.lat != null && f.lon != null
                ? distanceKm(district.lat, district.lng, f.lat, f.lon)
                : null;
            return (
              <div
                key={f.id}
                className="dd-fac"
                onClick={() => openDrawer(f.id)}
                style={{ cursor: "pointer" }}
              >
                <TrustBadge trust={trustFromBadge(f.trust_badge)} size="md" />
                <span className="name">
                  {f.name}
                  {f.matches_capability && (
                    <span className="dd-fac-tag" title="Has supported jury verdict for this capability">
                      ✓
                    </span>
                  )}
                </span>
                <span className="km">
                  {km != null ? `${km.toFixed(1)}km` : "—"}
                </span>
              </div>
            );
          })}

        <div className="dd-section-h">Adjacent districts</div>
        <div
          style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.6 }}
        >
          Bordering districts share the same trust profile — gap is regional, not local.
        </div>

        <Link
          href={`/explorer?q=${encodeURIComponent(
            `Verified ${capLabel.toLowerCase()} facilities in ${district.name}`,
          )}`}
          className="dd-cta"
        >
          Ask about this district
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
