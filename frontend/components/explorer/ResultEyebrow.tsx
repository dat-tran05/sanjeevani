interface ResultEyebrowProps {
  label: string;
  count?: string | number;
}

export function ResultEyebrow({ label, count }: ResultEyebrowProps) {
  return (
    <div className="result-eyebrow">
      <span>{label}</span>
      <span className="line" />
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  );
}
