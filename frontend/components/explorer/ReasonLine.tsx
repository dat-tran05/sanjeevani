"use client";

import { CitationPill } from "@/components/citation/CitationPill";
import type { FacilityCitation, RecommendedFacility } from "@/lib/types";

interface ReasonLineProps {
  facility: RecommendedFacility;
  onCitationClick: (facilityId: string, citation: FacilityCitation) => void;
}

export function ReasonLine({ facility, onCitationClick }: ReasonLineProps) {
  if (facility.id === "F-MZN-0214") {
    return (
      <span>
        24-hour emergency theatre with on-call surgery
        <CitationPill
          citation={{ ...facility.citations[0], facility_id: facility.id }}
          onClick={(c) => onCitationClick(facility.id, c)}
        />
        and laparoscopic appendectomy explicitly cited
        <CitationPill
          citation={{ ...facility.citations[1], facility_id: facility.id }}
          onClick={(c) => onCitationClick(facility.id, c)}
        />
        . Three judges agree.
      </span>
    );
  }
  if (facility.id === "F-DBH-0109") {
    return (
      <span>
        General surgery and obstetrics confirmed
        <CitationPill
          citation={{ ...facility.citations[0], facility_id: facility.id }}
          onClick={(c) => onCitationClick(facility.id, c)}
        />
        ; emergency theatre size and equipment unspecified
        <CitationPill
          citation={{ ...facility.citations[1], facility_id: facility.id }}
          onClick={(c) => onCitationClick(facility.id, c)}
        />
        . Partial verdict — 2 of 3 judges.
      </span>
    );
  }
  return (
    <span>
      Around-the-clock referral surgery
      <CitationPill
        citation={{ ...facility.citations[1], facility_id: facility.id }}
        onClick={(c) => onCitationClick(facility.id, c)}
      />
      , but equipment specificity is low. Judges split — Llama dissents
      <CitationPill
        citation={{ ...facility.citations[2], facility_id: facility.id }}
        onClick={(c) => onCitationClick(facility.id, c)}
      />
      . Resolved by extended-thinking tiebreaker.
    </span>
  );
}
