"use client";

import { CitationPill } from "@/components/citation/CitationPill";
import { TrustBadge } from "@/components/trust/TrustBadge";
import type { FacilityCitation, RecommendedFacility } from "@/lib/types";
import { ReasonLine } from "./ReasonLine";

interface RecommendationCardProps {
  facility: RecommendedFacility;
  rank: number;
  onCitationClick: (facilityId: string, citation: FacilityCitation) => void;
  onOpen: (facilityId: string) => void;
}

export function RecommendationCard({
  facility,
  rank,
  onCitationClick,
  onOpen,
}: RecommendationCardProps) {
  return (
    <div className="rec-card" onClick={() => onOpen(facility.id)}>
      <div className="rank">{rank}</div>
      <div className="rec-card-head">
        <h3 className="name">{facility.name}</h3>
        <span className="type-pill">{facility.type}</span>
      </div>
      <div className="meta">
        <span>
          {facility.district} · {facility.state}
        </span>
        <span className="sep">·</span>
        <span className="km">{facility.distance_km.toFixed(1)} km</span>
        <span className="sep">·</span>
        <span>ID {facility.id}</span>
      </div>
      <div className="rec-card-row">
        <TrustBadge trust={facility.trust} size="md" showLabel />
        <div className="rec-reason">
          <ReasonLine facility={facility} onCitationClick={onCitationClick} />
        </div>
      </div>
      <div className="rec-citations">
        {facility.citations.slice(0, 3).map((c) => (
          <CitationPill
            key={c.id}
            citation={{ ...c, facility_id: facility.id }}
            onClick={(cit) => onCitationClick(facility.id, cit)}
          />
        ))}
      </div>
    </div>
  );
}
