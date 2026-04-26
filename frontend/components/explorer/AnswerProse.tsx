import type { ReactNode } from "react";

interface AnswerProseProps {
  children: ReactNode;
}

/**
 * Strips internal naming conventions from displayed prose:
 *   - `{c1}` / `{{c1}}` citation markers (rendered elsewhere as CitationPills)
 *   - `(cap_es_F-A2E0F20C)` style claim_id parentheticals
 *   - bare hash-style facility IDs `F-XXXXXXXX`
 *   - extra spaces left after stripping
 */
function cleanProse(s: string): string {
  return s
    .replace(/\{\{?c\d+\}\}?/g, "")
    .replace(/\s*\((?:claim_id|cap)[_:][^)]*\)/g, "")
    .replace(/\s*\((cap_[a-z0-9_]+)\)/gi, "")
    .replace(/\s*\b(F-[A-F0-9]{6,})\b/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function AnswerProse({ children }: AnswerProseProps) {
  const text =
    typeof children === "string" ? cleanProse(children) : children;
  return <p className="answer-prose">{text}</p>;
}
