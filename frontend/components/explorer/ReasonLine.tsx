"use client";

import React from "react";
import { CitationPill } from "@/components/citation/CitationPill";
import type { FacilityCitation, RecommendedFacility } from "@/lib/types";

interface ReasonLineProps {
  facility: RecommendedFacility;
  onCitationClick: (facilityId: string, citation: FacilityCitation) => void;
}

/**
 * Renders the live backend prose, splicing each `{cN}` marker with the
 * matching CitationPill. Backend's aggregator emits prose like:
 *   "...described as an {c1} \"24x7 services\"..."
 * Returns null if there's no prose or no markers parsed — caller falls back
 * to the hardcoded demo lines below.
 */
/** Removes user-hostile internal IDs from a chunk of literal text:
 * - "(cap_es_F-A2E0F20C)" claim_id parentheticals
 * - bare hash facility IDs F-XXXXXXXX
 */
function cleanText(s: string): string {
  return s
    .replace(/\s*\((?:claim_id|cap)[_:][^)]*\)/g, "")
    .replace(/\s*\((cap_[a-z0-9_]+)\)/gi, "")
    .replace(/\s*\b(F-[A-F0-9]{6,})\b/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

function renderLiveProse(
  facility: RecommendedFacility,
  onCitationClick: (facilityId: string, citation: FacilityCitation) => void
): React.ReactNode | null {
  const prose = facility.prose;
  if (!prose) return null;
  const byId = new Map(facility.citations.map((c) => [c.id, c]));
  // Split on {cN} or {{cN}} markers, capturing the id.
  const parts = prose.split(/\{\{?(c\d+)\}\}?/g);
  if (parts.length === 1) {
    return <span>{cleanText(prose)}</span>;
  }
  return (
    <span>
      {parts.map((part, i) => {
        // Even indices = literal text; odd indices = captured citation id.
        if (i % 2 === 0) return <React.Fragment key={i}>{cleanText(part)}</React.Fragment>;
        const cit = byId.get(part);
        if (!cit) return null;
        return (
          <CitationPill
            key={i}
            citation={{ ...cit, facility_id: facility.id }}
            onClick={(c) => onCitationClick(facility.id, c)}
          />
        );
      })}
    </span>
  );
}

export function ReasonLine({ facility, onCitationClick }: ReasonLineProps) {
  const live = renderLiveProse(facility, onCitationClick);
  if (live) return live;

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
