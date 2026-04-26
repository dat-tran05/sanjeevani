"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HeroQuery } from "@/lib/types";

interface QueryBlockProps {
  queries: HeroQuery[];
  /** Query text currently being executed (read-only echo). */
  pendingText: string;
  /** Submit a query — used by Enter key, chip click, and Replay. */
  onSubmit: (text: string) => void;
  /** Called when user picks a chip (so the parent can switch activeQueryId for the answerLine). */
  onPickChip: (id: string) => void;
}

export function QueryBlock({
  queries,
  pendingText,
  onSubmit,
  onPickChip,
}: QueryBlockProps) {
  const [draft, setDraft] = useState(pendingText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the input in sync when the parent flips queries (e.g. via chip click).
  useEffect(() => {
    setDraft(pendingText);
  }, [pendingText]);

  // Auto-resize textarea to fit content (so long Q2 doesn't truncate).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [draft]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
  };

  return (
    <div className="query-block">
      <div className="query-eyebrow">
        <span>NGO Planner Query</span>
        <span className="line" />
        <span
          style={{ cursor: "pointer", color: "var(--gold)" }}
          onClick={() => submit(draft)}
        >
          ↻ Run
        </span>
      </div>
      <div className="query-wrap">
        <svg className="icn" viewBox="0 0 18 18" fill="none">
          <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 12l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <textarea
          ref={textareaRef}
          className="query-input"
          value={draft}
          rows={1}
          placeholder="Ask anything — e.g. 'rural Bihar dialysis within 50km'  (Enter to run, Shift+Enter for new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
        />
      </div>
      <div className="query-suggest">
        {queries.map((q) => (
          <button
            key={q.id}
            className={"suggest-chip" + (q.text === pendingText ? " active" : "")}
            onClick={() => {
              onPickChip(q.id);
              setDraft(q.text);
              submit(q.text);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
