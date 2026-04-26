interface StatePillProps {
  text?: string;
}

export function StatePill({ text = "API · live · 18ms" }: StatePillProps) {
  return (
    <span className="state-pill">
      <span className="dot" />
      {text}
    </span>
  );
}
