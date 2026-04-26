"use client";

import type { FacilityCitation } from "@/lib/types";

interface CitationPillProps {
  citation: FacilityCitation & { facility_id: string };
  active?: boolean;
  onClick?: (citation: FacilityCitation & { facility_id: string }) => void;
}

export function CitationPill({ citation, active = false, onClick }: CitationPillProps) {
  return (
    <span
      className={"citation-pill" + (active ? " active" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(citation);
      }}
    >
      <svg className="ico" viewBox="0 0 12 12" fill="none">
        <path d="M3 5h6M3 7h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="1.5" y="2" width="9" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span>{citation.id}</span>
      <span className="citation-tooltip">
        <div className="src-meta">Source quote · {citation.column}</div>
        <div className="src-text">
          &ldquo;<mark>{citation.text}</mark>&rdquo;
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--gold)",
          }}
        >
          ↗ Click to open evidence
        </div>
      </span>
    </span>
  );
}
