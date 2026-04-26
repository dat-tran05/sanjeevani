"use client";

import { useMemo, useState } from "react";
import type { DistrictPoint, StateGeo } from "@/lib/types";
import { STATES_GEO } from "@/lib/demo/states-geo";
import { DISTRICTS_GEO } from "@/lib/demo/districts-geo";

interface AtlasSearchProps {
  onPickDistrict: (district: DistrictPoint) => void;
  onPickState: (state: StateGeo) => void;
}

type SearchResult =
  | { kind: "district"; id: string; label: string; sub: string; item: DistrictPoint }
  | { kind: "state"; id: string; label: string; sub: string; item: StateGeo };

export function AtlasSearch({ onPickDistrict, onPickState }: AtlasSearchProps) {
  const [query, setQuery] = useState("");

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const dMatches: SearchResult[] = DISTRICTS_GEO.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || d.state.toLowerCase().includes(q)
    )
      .slice(0, 5)
      .map((d) => ({
        kind: "district",
        id: d.id,
        label: d.name,
        sub: d.state,
        item: d,
      }));
    const sMatches: SearchResult[] = STATES_GEO.filter((s) =>
      s.name.toLowerCase().includes(q)
    )
      .slice(0, 3)
      .map((s) => ({
        kind: "state",
        id: s.id,
        label: s.name,
        sub: s.capital,
        item: s,
      }));
    return [...dMatches, ...sMatches];
  }, [query]);

  const handlePick = (r: SearchResult) => {
    if (r.kind === "district") onPickDistrict(r.item);
    else onPickState(r.item);
    setQuery("");
  };

  return (
    <div className="atlas-search">
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        style={{ flexShrink: 0, opacity: 0.5 }}
      >
        <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M9 9l3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search districts or states…"
      />
      {query && (
        <button className="clear" onClick={() => setQuery("")}>
          ×
        </button>
      )}
      {searchResults.length > 0 && (
        <div className="atlas-search-results">
          {searchResults.map((r) => (
            <div
              key={r.kind + r.id}
              className="result"
              onClick={() => handlePick(r)}
            >
              <span className="kind">{r.kind === "district" ? "▸" : "◆"}</span>
              <span className="label">{r.label}</span>
              <span className="sub">{r.sub}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
