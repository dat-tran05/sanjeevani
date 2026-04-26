import type { ReactNode } from "react";

interface AnswerProseProps {
  children: ReactNode;
}

export function AnswerProse({ children }: AnswerProseProps) {
  return <p className="answer-prose">{children}</p>;
}
