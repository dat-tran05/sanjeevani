interface LeafGlyphProps {
  size?: number;
  className?: string;
}

export function LeafGlyph({ size = 22, className = "" }: LeafGlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 22C12 22 4 18 4 11C4 6 8 2 12 2C16 2 20 6 20 11C20 18 12 22 12 22Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M12 4 L12 21" stroke="currentColor" strokeWidth="1.2" opacity="0.65" />
      <path
        d="M12 9 L8 7 M12 12 L7.5 10 M12 15 L8 14 M12 9 L16 7 M12 12 L16.5 10 M12 15 L16 14"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>
  );
}
