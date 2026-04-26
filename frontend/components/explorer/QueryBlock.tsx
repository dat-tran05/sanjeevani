"use client";

import { HERO_QUERIES } from "@/lib/demo/hero-queries";

interface QueryBlockProps {
  activeQueryId: string;
  onQueryChange: (id: string) => void;
  onReplay: () => void;
}

export function QueryBlock({ activeQueryId, onQueryChange, onReplay }: QueryBlockProps) {
  const activeQuery = HERO_QUERIES.find((q) => q.id === activeQueryId);
  const text = activeQuery?.text ?? "";

  return (
    <div className="query-block">
      <div className="query-eyebrow">
        <span>NGO Planner Query</span>
        <span className="line" />
        <span
          style={{ cursor: "pointer", color: "var(--gold)" }}
          onClick={onReplay}
        >
          ↻ Replay
        </span>
      </div>
      <div className="query-wrap">
        <svg className="icn" viewBox="0 0 18 18" fill="none">
          <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 12l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input className="query-input" value={text} readOnly />
      </div>
      <div className="query-suggest">
        {HERO_QUERIES.map((q) => (
          <button
            key={q.id}
            className={"suggest-chip" + (q.id === activeQueryId ? " active" : "")}
            onClick={() => {
              onQueryChange(q.id);
              onReplay();
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
