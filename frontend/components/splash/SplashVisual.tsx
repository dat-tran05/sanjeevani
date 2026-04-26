"use client";

import { useEffect, useState } from "react";
import { SPLASH_STATES } from "@/lib/demo/splash-states";

interface Pin {
  id: number;
  x: number;
  y: number;
  delay: number;
  sz: number;
}

function generatePins(): Pin[] {
  const out: Pin[] = [];
  for (let i = 0; i < 240; i++) {
    const s = SPLASH_STATES[Math.floor(Math.random() * SPLASH_STATES.length)]!;
    out.push({
      id: i,
      x: s.cx + (Math.random() - 0.5) * 60,
      y: s.cy + (Math.random() - 0.5) * 60,
      delay: Math.random() * 1.2,
      sz: Math.random() * 1.5 + 0.8,
    });
  }
  return out;
}

export function SplashVisual() {
  // Pins generated client-side after mount — Math.random() is impure so it can't
  // run during render (would also cause an SSR hydration mismatch). The lint
  // rule warns against setState-in-effect, but a one-shot post-mount init for
  // client-only random data is the canonical pattern here.
  const [pins, setPins] = useState<Pin[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPins(generatePins());
  }, []);

  return (
    <div className="splash-visual">
      <div className="corner-mark">India · 10,053 indexed</div>
      <svg
        className="india-svg"
        viewBox="0 0 1000 800"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby="splash-india-title"
      >
        <title id="splash-india-title">
          Stylized map of India with 240 facility pins lighting up across all states and Union
          Territories, plus a pulsing target over Bihar marking the demo query location.
        </title>
        <defs>
          <linearGradient id="india-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(43,182,115,0.06)" />
            <stop offset="100%" stopColor="rgba(212,166,97,0.04)" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <ellipse
            key={i}
            cx="450"
            cy="430"
            rx={300 - i * 30}
            ry={260 - i * 28}
            stroke="rgba(212,166,97,0.10)"
            strokeWidth="0.7"
            fill="none"
          />
        ))}
        {SPLASH_STATES.map((s) => (
          <path
            key={s.id}
            d={s.path}
            fill="url(#india-fill)"
            stroke="rgba(212,166,97,0.30)"
            strokeWidth="0.8"
          />
        ))}
        {pins.map((p) => (
          <circle
            key={p.id}
            className="pin"
            cx={p.x}
            cy={p.y}
            r={p.sz}
            style={{ animationDelay: `${p.delay}s` }}
          />
        ))}
        <circle
          cx="645"
          cy="290"
          r="14"
          fill="none"
          stroke="var(--gold)"
          strokeWidth="1.2"
          opacity="0.6"
        >
          <animate
            attributeName="r"
            from="14"
            to="36"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.6"
            to="0"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
        <circle cx="645" cy="290" r="4" fill="var(--gold)" />
      </svg>
    </div>
  );
}
