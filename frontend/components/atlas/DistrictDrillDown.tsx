"use client";

import Link from "next/link";
import type { CapabilityId, DistrictPoint } from "@/lib/types";
import { CAPABILITIES } from "@/lib/demo/capability-bias";
import { FACILITIES } from "@/lib/demo/facilities";
import { TrustBadge } from "@/components/trust/TrustBadge";
import { useDrawer } from "@/lib/hooks/use-drawer";

interface DistrictDrillDownProps {
  district: DistrictPoint;
  capability: CapabilityId;
}

export function DistrictDrillDown({
  district,
  capability,
}: DistrictDrillDownProps) {
  const { openDrawer } = useDrawer();
  const capLabel =
    CAPABILITIES.find((c) => c.id === capability)?.label ?? "";
  const fac1 = FACILITIES["F-MZN-0214"];
  const fac2 = FACILITIES["F-DBH-0109"];

  const gapWord =
    district.gap > 0.7
      ? "severe gap"
      : district.gap > 0.5
        ? "underserved"
        : district.gap > 0.3
          ? "moderate"
          : "well-served";

  const commentary =
    district.id === "MZN"
      ? "Muzaffarpur shows the pattern: many listed facilities, few verifiable for emergency surgery. Trust scores cluster low on Specificity — descriptions are short and rarely cite procedure detail."
      : district.id === "BGS"
        ? "Begusarai is among the most under-verified districts in eastern Bihar. Of 24 listed facilities, only 1 carries a supported emergency-surgery verdict from all three judges."
        : district.gap > 0.7
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
        <div
          className="dd-fac"
          onClick={() => openDrawer("F-MZN-0214")}
          style={{ cursor: "pointer" }}
        >
          <TrustBadge trust={fac1.trust} size="md" />
          <span className="name">{fac1.name}</span>
          <span className="km">{fac1.distance_km.toFixed(1)}km</span>
        </div>
        <div
          className="dd-fac"
          onClick={() => openDrawer("F-DBH-0109")}
          style={{ cursor: "pointer" }}
        >
          <TrustBadge trust={fac2.trust} size="md" />
          <span className="name">{fac2.name}</span>
          <span className="km">{fac2.distance_km.toFixed(1)}km</span>
        </div>
        <div className="dd-fac">
          <TrustBadge
            trust={{
              existence: 2,
              coherence: 2,
              recency: 1,
              specificity: 1,
              score: 0.52,
            }}
            size="md"
          />
          <span className="name">Sitamarhi Government Hospital</span>
          <span className="km">71.2km</span>
        </div>

        <div className="dd-section-h">Adjacent districts</div>
        <div
          style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.6 }}
        >
          {district.id === "MZN" &&
            "Vaishali (gap 0.74) · Darbhanga (0.71) · Sitamarhi (0.79) — all within 80km."}
          {district.id === "BGS" &&
            "Begusarai sits between Patna's well-served corridor and Bihar's eastern desert."}
          {district.id !== "MZN" &&
            district.id !== "BGS" &&
            "Bordering districts share the same trust profile — gap is regional, not local."}
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
