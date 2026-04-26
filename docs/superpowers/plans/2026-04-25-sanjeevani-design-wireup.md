# Sanjeevani Design Wire-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `Chat` frontend with a faithful TypeScript port of the Claude Designs handoff (Splash · Explorer · Atlas · Methodology, plus Trust Badge / Citation Pill / Jury Panel / Facility Drawer / Why-Not-These), wired to existing backend SSE events with typed baked fallbacks for events the partner is still building.

**Architecture:** Next.js 16 App Router, four routes with shared layout (TopBar + global FacilityDrawer mounted via URL params). Tailwind 4 `@theme` tokens + verbatim component CSS imports. Discriminated-union SSE event types in `lib/sse.ts` so live and demo events render identically. MapLibre GL on `/atlas` only, dynamically imported. All non-SSE data stubbed in typed `lib/demo/*.ts` modules until the backend partner ships REST endpoints.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript strict, Tailwind 4, shadcn/ui (existing), `next/font/google` (Fraunces / Inter / JetBrains Mono), `maplibre-gl` (new dep).

**Spec:** `docs/superpowers/specs/2026-04-25-sanjeevani-design-wireup.md`

**Design source bundle (read-only reference):** `C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\` — `Sanjeevani.html`, `styles.css`, `components-base.jsx`, `components-explorer.jsx`, `components-atlas.jsx`, `data.js`, `india-geo.js`, `india-svg.js`.

**Important — Next.js 16 caveat:** Per `frontend/AGENTS.md`, Next 16 has breaking changes from training data. Before touching any Next-specific API (`next/font`, `cacheComponents`, route handlers, `<Link>` semantics, `useSearchParams`/`useRouter`), read `frontend/node_modules/next/dist/docs/` for the relevant page.

---

## File Structure

### New files
```
frontend/
├── app/
│   ├── layout.tsx                          (overwrite)
│   ├── globals.css                         (overwrite)
│   ├── page.tsx                            (overwrite — Splash)
│   ├── explorer/page.tsx                   NEW
│   ├── atlas/page.tsx                      NEW
│   └── methodology/page.tsx                NEW
├── styles/
│   ├── shell.css splash.css explorer.css trace.css
│   ├── trust.css citation.css atlas.css drawer.css about.css
│   └── tokens.css
├── components/
│   ├── shell/{LeafGlyph,BrandMark,TopoBg,TopBar,StatePill}.tsx
│   ├── splash/{SplashHero,SplashVisual}.tsx
│   ├── trust/TrustBadge.tsx
│   ├── citation/{CitationPill,CitationTooltip}.tsx
│   ├── drawer/{FacilityDrawer,RawRowCollapse,CapabilityVerdictsGrid}.tsx
│   ├── trace/{TraceStream,TraceEvent,ThinkingNode,AgentStepNode,ToolCallNode,
│   │          ProposalsNode,JuryPanel,ValidatorNode,AnswerReadyNode}.tsx
│   ├── explorer/{QueryBlock,AnswerProse,RecommendationCard,ReasonLine,WhyNotThese,ResultEyebrow}.tsx
│   └── atlas/{AtlasMap,CapabilitySegmented,LayerToggles,AtlasSearch,AtlasLegend,
│              AtlasBreadcrumb,AtlasTooltip,DistrictDrillDown}.tsx
├── lib/
│   ├── sse.ts                              (overwrite)
│   ├── types.ts                            NEW
│   ├── hooks/{use-event-stream,use-drawer}.ts
│   ├── demo/{trace,facilities,exclusions,hero-queries,
│   │         states-geo,districts-geo,capability-bias,topo-svg}.ts
│   └── maps/{geo-utils,maplibre-setup}.ts
└── tests/                                  NEW (Vitest config in Task 0)
    ├── setup.ts
    └── unit/{sse,geo-utils,use-event-stream}.test.ts

docs/sse-event-contract.md                  NEW (partner handoff)
```

### Files deleted at the end (Task 32)
- `frontend/app/page.tsx` (replaced earlier — confirm clean)
- `frontend/components/chat/Chat.tsx`

---

## Task 0: Dev tooling — install Vitest + maplibre, configure paths

**Why:** Several tasks below have unit tests. Vitest is the standard for Vite/Next 16 frontend tests. `maplibre-gl` is the only runtime dep we add. Setting both up first means later tasks can run tests freely.

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/tests/setup.ts`

- [ ] **Step 1: Install deps**

```bash
cd frontend
npm install --save maplibre-gl
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Add test script to `package.json`**

In `frontend/package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 4: Create `frontend/tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Verify**

```bash
cd frontend && npm run test
```
Expected: `No test files found, exiting with code 0` (or similar — Vitest reports zero tests but exits cleanly).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/tests/setup.ts
git commit -m "chore(frontend): add vitest + maplibre-gl deps"
```

---

## Task 1: Tailwind 4 @theme tokens

**Why:** The design uses 30+ CSS variables (warm-civic palette, motion timings, fonts). Putting them in Tailwind 4's `@theme` block lets us use `bg-bg`, `text-fg-mute`, `font-display`, etc., as utility classes throughout the port.

**Files:**
- Overwrite: `frontend/app/globals.css`
- Create: `frontend/styles/tokens.css`

- [ ] **Step 1: Create `frontend/styles/tokens.css`**

Copy the entire `:root { ... }` block (lines 5-74) and the palette/mode override blocks (lines 77-121) from `C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\styles.css` verbatim. These define `--ink`, `--green`, `--gold`, `--crimson`, `--paper`, plus mode-resolved `--bg`/`--fg`/`--line` and the three palette variants. They also declare `--display`, `--sans`, `--mono`, `--ease*`, `--t-*`, `--r-*`, `--shadow-*`.

- [ ] **Step 2: Overwrite `frontend/app/globals.css`**

```css
@import "tailwindcss";
@import "../styles/tokens.css";

@theme {
  --color-bg: var(--bg);
  --color-bg-2: var(--bg-2);
  --color-bg-3: var(--bg-3);
  --color-line: var(--line);
  --color-line-2: var(--line-2);
  --color-fg: var(--fg);
  --color-fg-2: var(--fg-2);
  --color-fg-3: var(--fg-3);
  --color-fg-mute: var(--fg-mute);
  --color-green: var(--green);
  --color-green-deep: var(--green-deep);
  --color-green-soft: var(--green-soft);
  --color-gold: var(--gold);
  --color-gold-deep: var(--gold-deep);
  --color-gold-soft: var(--gold-soft);
  --color-crimson: var(--crimson);
  --color-crimson-deep: var(--crimson-deep);
  --font-display: var(--display);
  --font-sans: var(--sans);
  --font-mono: var(--mono);
}

/* Reset / base — copied from design styles.css §Reset */
*,
*::before,
*::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "ss01", "cv11", "tnum" 0;
  overflow: hidden;
}

button { font-family: inherit; cursor: pointer; }
input, textarea { font-family: inherit; }
::selection { background: var(--gold-glow); color: var(--fg); }

*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: var(--neutral-10); border-radius: 999px; }
*::-webkit-scrollbar-thumb:hover { background: var(--neutral-20); }

#root, body > div:first-child {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Verify build does not error**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css frontend/styles/tokens.css
git commit -m "feat(frontend): tailwind 4 theme tokens from design system"
```

---

## Task 2: Component CSS modules (split design's styles.css)

**Why:** The design's CSS has hand-tuned animations, gradients, and layered shadows that lose fidelity when ported to utilities. Keep them as imported component-scoped files so each later round can pull in exactly the styles its components need.

**Files:**
- Create: `frontend/styles/{shell,splash,explorer,trace,trust,citation,atlas,drawer,about}.css`
- Modify: `frontend/app/globals.css` (add @import lines)

- [ ] **Step 1: Split source CSS by section**

Open `C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\styles.css` and copy the following ranges verbatim into corresponding files (line numbers from the source):

| Source range | Destination file | Contents |
|---|---|---|
| 168-261 | `styles/shell.css` | `.topbar`, `.brand`, `.brand-sub`, `.topbar-tabs`, `.tab`, `.topbar-end`, `.state-pill`, `@keyframes pulse` |
| 266-287 | `styles/shell.css` (append) | `.topo-bg` |
| 292-342 | `styles/shell.css` (append) | `.btn`, `.btn-primary`, `.btn-ghost`, `.kbd`, `.divider` |
| 347-487 | `styles/splash.css` | `.splash`, `.splash-canvas`, `.splash-text`, `.splash-eyebrow`, `.splash-headline`, `.splash-tag`, `.splash-cta-row`, `.splash-stats`, `.splash-visual`, `@keyframes pin-light` |
| 492-836 | `styles/explorer.css` | `.explorer`, `.query-block`, `.query-eyebrow`, `.query-input`, `.query-wrap`, `.query-suggest`, `.suggest-chip`, `.result-section`, `.result-eyebrow`, `.answer-prose`, `.rec-card` and children, `.wnt`, `.wnt-row` |
| 615-689 | `styles/citation.css` | `.citation-pill`, `.citation-tooltip` |
| 776-836 | `styles/trust.css` | `.trust-badge`, `.trust-bar`, `.trust-badge-label` |
| 841-1075 | `styles/trace.css` | `.trace-panel`, `.trace-head`, `.trace-stream`, `.trace-event`, `@keyframes trace-in`, `@keyframes spin`, `.thinking`, `@keyframes blink`, `.tool-badge`, `.tool-out`, `.proposals`, `.proposal` |
| 1079-1276 | `styles/trace.css` (append) | `.jury-panel`, `.jury-head`, `.jury-agree*`, `.jury-verdict-pill`, `.jury-cols`, `.jury-col*`, `.tiebreaker`, `@keyframes fill-bar` |
| 1356-1716 | `styles/atlas.css` | `.atlas`, `.atlas-stage`, `.atlas-controls`, `.atlas-segmented`, `.atlas-seg`, `.atlas-layers`, `.atlas-layer-row`, `.atlas-legend`, `.atlas-map-container` and maplibre overrides, `.atlas-rightcol`, `.atlas-search`, `.atlas-search-results`, `.atlas-zoom`, `.atlas-breadcrumb`, `.atlas-scale`, `.atlas-tooltip` |
| 1719-1822 | `styles/atlas.css` (append) | `.drilldown`, `.drilldown-head`, `.drilldown-body`, `.dd-stat`, `.dd-section-h`, `.dd-fac`, `.dd-commentary` |
| 1826-2057 | `styles/drawer.css` | `.drawer-overlay`, `.drawer`, `.drawer-head`, `.drawer-close`, `.drawer-eyebrow`, `.drawer-body`, `.drawer-section*`, `.trust-detail`, `.trust-dim-list`, `.trust-dim-row`, `.capabilities-grid`, `.cap-row`, `.description-block`, `.raw-collapse`, `.raw-head`, `.raw-content` |
| 2061-2179 | `styles/about.css` | `.about`, `.about h1/h2/p`, `.about .lede`, `.about .pull`, `.about-pipeline`, `.pipe-step*`, `.judges-grid`, `.judge-card*` |
| 2183-2188 | `styles/about.css` (append) | `.footnote` |

Skip lines 1-167 (already covered by tokens.css) and lines 2190-2196 (already in globals.css).

- [ ] **Step 2: Append @import lines to `globals.css`**

After the existing `@import "../styles/tokens.css";`, add:

```css
@import "../styles/shell.css";
@import "../styles/splash.css";
@import "../styles/trust.css";
@import "../styles/citation.css";
@import "../styles/explorer.css";
@import "../styles/trace.css";
@import "../styles/atlas.css";
@import "../styles/drawer.css";
@import "../styles/about.css";
```

- [ ] **Step 3: Verify dev server boots**

```bash
cd frontend && npm run dev
```
Expected: server starts on `:3000`. Visit `localhost:3000` — should render bg-ink color (no content yet, but no errors).

Stop the dev server (`Ctrl+C`).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css frontend/styles/
git commit -m "feat(frontend): port design system CSS as component modules"
```

---

## Task 3: Fonts via next/font/google

**Why:** The design's HTML uses a Google Fonts CDN `<link>`. Next 16 best practice is `next/font/google` — self-hosts at build time, no FOUT, no extra HTTP. Bind to the design's CSS variables.

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Read Next 16 docs**

```bash
ls "C:\Users\datct\CSProjects\Henry's Github\sanjeevani\frontend\node_modules\next\dist\docs"
```
Look for the font-related doc. Skim it before editing layout.tsx.

- [ ] **Step 2: Overwrite `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sanjeevani — Find help. Save lives.",
  description:
    "A reasoning layer over 10,053 Indian healthcare facilities — ranked, cited, verified by three independent AI judges.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body data-mode="dark" data-palette="warm" data-display="fraunces" data-topo="on">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Update `frontend/styles/tokens.css` to use the next/font variables**

Find the lines:
```css
--display: "Fraunces", "Tiempos Headline", Georgia, serif;
--sans: "Inter", "Söhne", system-ui, -apple-system, sans-serif;
--mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace;
```

Replace with:
```css
--display: var(--font-fraunces), "Tiempos Headline", Georgia, serif;
--sans: var(--font-inter), system-ui, -apple-system, sans-serif;
--mono: var(--font-jetbrains-mono), "IBM Plex Mono", ui-monospace, Menlo, monospace;
```

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run dev
```
Visit `localhost:3000`. Use DevTools Computed Styles on `<body>` — `font-family` should resolve to a class containing `__Inter_*`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/layout.tsx frontend/styles/tokens.css
git commit -m "feat(frontend): wire next/font for Fraunces, Inter, JetBrains Mono"
```

---

## Task 4: Shell components — LeafGlyph, BrandMark, TopoBg, StatePill

**Why:** These are the cosmetic primitives the TopBar (Task 5) and Splash (Task 11) depend on. Pure SVG and CSS — no state.

**Files:**
- Create: `frontend/components/shell/LeafGlyph.tsx`
- Create: `frontend/components/shell/BrandMark.tsx`
- Create: `frontend/components/shell/TopoBg.tsx`
- Create: `frontend/components/shell/StatePill.tsx`
- Create: `frontend/lib/demo/topo-svg.ts`

- [ ] **Step 1: Port `india-svg.js` to TypeScript**

Open `C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\india-svg.js`. The file assigns `window.SANJ = window.SANJ || {}; window.SANJ.TOPO_SVG = '<svg ...>';`

Create `frontend/lib/demo/topo-svg.ts`:

```ts
// Topographic background SVG — verbatim port of india-svg.js TOPO_SVG.
export const TOPO_SVG = /* paste the SVG string from india-svg.js */ `…`;
```

Copy the entire SVG string (single-quoted in the source, ~7KB) into the template literal.

- [ ] **Step 2: Create `frontend/components/shell/LeafGlyph.tsx`**

```tsx
export function LeafGlyph({ size = 22, className = "" }: { size?: number; className?: string }) {
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
```

- [ ] **Step 3: Create `frontend/components/shell/BrandMark.tsx`**

```tsx
"use client";

import Link from "next/link";
import { LeafGlyph } from "./LeafGlyph";

export function BrandMark() {
  return (
    <Link href="/" className="brand">
      <LeafGlyph className="leaf" size={22} />
      <span>Sanjeevani</span>
      <span className="brand-sub">Demo · India · 10,053 facilities</span>
    </Link>
  );
}
```

- [ ] **Step 4: Create `frontend/components/shell/TopoBg.tsx`**

```tsx
import { TOPO_SVG } from "@/lib/demo/topo-svg";

export function TopoBg() {
  return <div className="topo-bg" dangerouslySetInnerHTML={{ __html: TOPO_SVG }} />;
}
```

- [ ] **Step 5: Create `frontend/components/shell/StatePill.tsx`**

```tsx
export function StatePill({
  text = "API · live · 18ms",
}: {
  text?: string;
}) {
  return (
    <span className="state-pill">
      <span className="dot" />
      {text}
    </span>
  );
}
```

- [ ] **Step 6: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/shell/ frontend/lib/demo/topo-svg.ts
git commit -m "feat(frontend): shell primitives — LeafGlyph, BrandMark, TopoBg, StatePill"
```

---

## Task 5: TopBar with route-aware tabs

**Why:** The design uses tab state in `app.jsx`; we use route-driven active state via `usePathname`.

**Files:**
- Create: `frontend/components/shell/TopBar.tsx`

- [ ] **Step 1: Create `frontend/components/shell/TopBar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";
import { StatePill } from "./StatePill";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/explorer", label: "Explorer" },
  { href: "/atlas", label: "Crisis Map" },
  { href: "/methodology", label: "Methodology" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function TopBar() {
  const pathname = usePathname();
  return (
    <div className="topbar">
      <BrandMark />
      <div className="topbar-tabs">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={"tab" + (isActive(pathname, t.href) ? " active" : "")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="topbar-end">
        <StatePill />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount TopBar in `frontend/app/layout.tsx`**

In the `<body>` block, replace `{children}` with:

```tsx
<TopBar />
{children}
```

Add the import at the top:
```tsx
import { TopBar } from "@/components/shell/TopBar";
```

- [ ] **Step 3: Verify visual**

```bash
cd frontend && npm run dev
```
Visit `localhost:3000`. Top bar should render: leaf glyph + "Sanjeevani" + sub-line + four tabs (Home active) + state pill on right with pulsing dot.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/shell/TopBar.tsx frontend/app/layout.tsx
git commit -m "feat(frontend): TopBar with route-driven active tab"
```

---

## Task 6: TrustBadge component

**Why:** Used by RecommendationCard, FacilityDrawer, DistrictDrillDown. Always 4 vertical bars — never collapsed to one number, per OVERVIEW §6.

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/components/trust/TrustBadge.tsx`

- [ ] **Step 1: Create `frontend/lib/types.ts`** (full domain type module — used by every later round)

```ts
export interface FacilityTrust {
  existence: 0 | 1 | 2 | 3;
  coherence: 0 | 1 | 2 | 3;
  recency: 0 | 1 | 2 | 3;
  specificity: 0 | 1 | 2 | 3;
  score: number; // 0-1
}

export interface FacilityCitation {
  id: string;
  column: string;
  char_start: number;
  char_end: number;
  text: string;
}

export type Verdict = "supported" | "partial" | "unsupported";

export interface CapabilityVerdict {
  name: string;
  agree: "3/3" | "2/3" | "1/3" | "0/3";
  verdict: Verdict;
}

export interface RecommendedFacility {
  id: string;
  name: string;
  type: string;
  state: string;
  district: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  trust: FacilityTrust;
  capabilities: CapabilityVerdict[];
  citations: FacilityCitation[];
  description: string;
}

export interface ExcludedFacility {
  name: string;
  district: string;
  type: string;
  reason: string;
  verdict: "partial" | "unsupported";
}

export interface DistrictPoint {
  id: string;
  name: string;
  state: string;
  pop: number;
  facs: number;
  verified: number;
  gap: number; // 0-1
  lng: number;
  lat: number;
}

export interface StateGeo {
  id: string;
  name: string;
  abbr: string;
  capital: string;
  rings: Array<Array<[number, number]>>;
}

export interface CapabilityDef {
  id: "emergency" | "neonatal" | "dialysis" | "oncology" | "cardiac" | "trauma";
  label: string;
}

export interface HeroQuery {
  id: string;
  label: string;
  text: string;
  answerLine: string;
}
```

- [ ] **Step 2: Create `frontend/components/trust/TrustBadge.tsx`**

```tsx
import type { FacilityTrust } from "@/lib/types";

interface TrustBadgeProps {
  trust: FacilityTrust;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const DIMS = [
  { key: "existence", label: "Existence" },
  { key: "coherence", label: "Coherence" },
  { key: "recency", label: "Recency" },
  { key: "specificity", label: "Specificity" },
] as const;

export function TrustBadge({ trust, size = "md", showLabel = false }: TrustBadgeProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className={`trust-badge ${size}`}>
        {DIMS.map((d) => {
          const val = trust[d.key];
          return (
            <div
              key={d.key}
              className="trust-bar"
              data-dim={d.key}
              title={`${d.label}: ${val}/3`}
            >
              <div className="fill" style={{ height: `${(val / 3) * 100}%` }} />
            </div>
          );
        })}
      </div>
      {showLabel && (
        <div className="trust-badge-label">
          <span className="num">{trust.score.toFixed(2)}</span>
          <span>Trust</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/components/trust/TrustBadge.tsx
git commit -m "feat(frontend): TrustBadge with strict 0-3 dimension types"
```

---

## Task 7: CitationPill + tooltip

**Why:** The design's most-replayed interaction. Hover shows source span; click opens drawer.

**Files:**
- Create: `frontend/components/citation/CitationPill.tsx`

- [ ] **Step 1: Create `frontend/components/citation/CitationPill.tsx`**

```tsx
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
        <div className="src-meta">
          {citation.facility_id} · {citation.column} · char {citation.char_start}–{citation.char_end}
        </div>
        <div className="src-text">
          …<mark>{citation.text}</mark>…
        </div>
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/citation/
git commit -m "feat(frontend): CitationPill with hover tooltip"
```

---

## Task 8: use-drawer hook (URL params)

**Why:** Drawer is mounted in layout — its open state needs to survive across route changes and be deep-linkable. URL params are the cleanest mechanism.

**Files:**
- Create: `frontend/lib/hooks/use-drawer.ts`
- Create: `frontend/tests/unit/use-drawer.test.tsx`

- [ ] **Step 1: Create `frontend/tests/unit/use-drawer.test.tsx`** (failing test)

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock next/navigation BEFORE importing the hook
const replaceMock = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/explorer",
}));

import { useDrawer } from "@/lib/hooks/use-drawer";

describe("useDrawer", () => {
  it("returns null facilityId when no param present", () => {
    const { result } = renderHook(() => useDrawer());
    expect(result.current.facilityId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("openDrawer pushes facility + citation params to URL", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => {
      result.current.openDrawer("F-MZN-0214", "c1");
    });
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("facility=F-MZN-0214"),
      expect.objectContaining({ scroll: false })
    );
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("citation=c1"),
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
cd frontend && npm run test
```
Expected: FAIL — `useDrawer is not defined`.

- [ ] **Step 3: Create `frontend/lib/hooks/use-drawer.ts`**

```ts
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export interface UseDrawerReturn {
  facilityId: string | null;
  citationId: string | null;
  isOpen: boolean;
  openDrawer: (facilityId: string, citationId?: string) => void;
  closeDrawer: () => void;
}

export function useDrawer(): UseDrawerReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const facilityId = searchParams.get("facility");
  const citationId = searchParams.get("citation");

  const openDrawer = useCallback(
    (facilityId: string, citationId?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("facility", facilityId);
      if (citationId) params.set("citation", citationId);
      else params.delete("citation");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const closeDrawer = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("facility");
    params.delete("citation");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return {
    facilityId,
    citationId,
    isOpen: !!facilityId,
    openDrawer,
    closeDrawer,
  };
}
```

- [ ] **Step 4: Run test**

```bash
cd frontend && npm run test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/hooks/use-drawer.ts frontend/tests/unit/use-drawer.test.tsx
git commit -m "feat(frontend): use-drawer hook with URL-param state"
```

---

## Task 9: lib/demo/facilities.ts (3 hero facilities)

**Why:** RecommendationCard, ReasonLine, FacilityDrawer, DistrictDrillDown all read these. Port from `data.js` `FACILITIES` constant.

**Files:**
- Create: `frontend/lib/demo/facilities.ts`

- [ ] **Step 1: Open source `data.js`**

`C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\data.js`. Find the `FACILITIES` object — it's a `Record<string, Facility>` keyed by `F-MZN-0214`, `F-DBH-0109`, `F-PAT-0331`. Each has `id`, `name`, `type`, `state`, `district`, `distance_km`, `description`, `trust: {existence, coherence, recency, specificity, score}`, `capabilities: [{name, agree, verdict}]`, `citations: [{id, column, char_start, char_end, text}]`.

- [ ] **Step 2: Create `frontend/lib/demo/facilities.ts`**

```ts
import type { RecommendedFacility } from "@/lib/types";

export const FACILITIES: Record<string, RecommendedFacility> = {
  // Paste the 3 facility objects from data.js verbatim, then add latitude/longitude
  // (use the values implied by data.js comments — F-MZN-0214 lat 26.1224 lng 85.3614,
  //  F-DBH-0109 lat 26.15 lng 85.90, F-PAT-0331 lat 25.61 lng 85.14).
};

export const HERO_FACILITY_IDS = ["F-MZN-0214", "F-DBH-0109", "F-PAT-0331"] as const;
```

(Engineer: copy each facility object as a TypeScript object literal, add the lat/long fields, ensure types match `RecommendedFacility`. The structure is identical to the source — just add a type annotation and lat/long.)

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/demo/facilities.ts
git commit -m "feat(frontend): port hero facilities to typed demo module"
```

---

## Task 10: FacilityDrawer + supporting components

**Why:** Mounted globally via layout — opens from any tab. Renders trust badge, capability verdicts, full description with citations highlighted, raw row collapse.

**Files:**
- Create: `frontend/components/drawer/FacilityDrawer.tsx`
- Create: `frontend/components/drawer/RawRowCollapse.tsx`
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Create `frontend/components/drawer/RawRowCollapse.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { RecommendedFacility } from "@/lib/types";

export function RawRowCollapse({ facility }: { facility: RecommendedFacility }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="raw-collapse" data-open={open}>
      <div className="raw-head" onClick={() => setOpen(!open)}>
        <span>{open ? "Hide" : "Show"} 41 columns</span>
        <span style={{ fontFamily: "var(--sans)", textTransform: "none", letterSpacing: 0, color: "var(--fg-mute)" }}>
          {open ? "▴" : "▾"}
        </span>
      </div>
      <div className="raw-content">
        facility_id: {facility.id}<br />
        name: &quot;{facility.name}&quot;<br />
        type: &quot;{facility.type}&quot;<br />
        state: &quot;{facility.state}&quot;<br />
        district: &quot;{facility.district}&quot;<br />
        latitude: {facility.latitude} · longitude: {facility.longitude}<br />
        description_len: {facility.description.length} chars<br />
        trust.score: {facility.trust.score.toFixed(3)}<br />
        <span style={{ color: "var(--fg-mute)" }}>· · · 32 more columns</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/components/drawer/FacilityDrawer.tsx`**

Port `components-atlas.jsx:688-820` to TypeScript. Use the `useDrawer` hook for open state and the `FACILITIES` lookup. Type all props with `RecommendedFacility`. The description-with-citations rendering loop (lines 706-714) becomes:

```tsx
"use client";

import { FACILITIES } from "@/lib/demo/facilities";
import { useDrawer } from "@/lib/hooks/use-drawer";
import { TrustBadge } from "@/components/trust/TrustBadge";
import { RawRowCollapse } from "./RawRowCollapse";

export function FacilityDrawer() {
  const { facilityId, citationId, isOpen, closeDrawer } = useDrawer();
  const facility = facilityId ? FACILITIES[facilityId] : null;

  // Drawer always renders; visibility toggled by .open class for animation
  if (!facility) {
    return (
      <>
        <div className={"drawer-overlay" + (isOpen ? " open" : "")} onClick={closeDrawer} />
        <div className={"drawer" + (isOpen ? " open" : "")} />
      </>
    );
  }

  const dims = [
    { lbl: "Existence", val: facility.trust.existence, max: 3 },
    { lbl: "Coherence", val: facility.trust.coherence, max: 3 },
    { lbl: "Recency", val: facility.trust.recency, max: 3 },
    { lbl: "Specificity", val: facility.trust.specificity, max: 3 },
  ];

  const desc = facility.description;
  const sortedCits = [...facility.citations].sort((a, b) => a.char_start - b.char_start);
  type Segment = { type: "text"; text: string } | { type: "mark"; text: string; id: string };
  const segments: Segment[] = [];
  let cur = 0;
  for (const c of sortedCits) {
    if (c.char_start > cur) segments.push({ type: "text", text: desc.slice(cur, c.char_start) });
    segments.push({ type: "mark", text: desc.slice(c.char_start, c.char_end), id: c.id });
    cur = c.char_end;
  }
  if (cur < desc.length) segments.push({ type: "text", text: desc.slice(cur) });

  return (
    <>
      <div className={"drawer-overlay open"} onClick={closeDrawer} />
      <div className={"drawer open"}>
        <div className="drawer-head">
          <button className="drawer-close" onClick={closeDrawer} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="drawer-eyebrow">
            <span>Facility profile</span>
            <span className="id">· {facility.id}</span>
          </div>
          <h2>{facility.name}</h2>
          <div className="meta">
            <span>{facility.type}</span>
            <span style={{ color: "var(--fg-mute)" }}>·</span>
            <span>{facility.district}, {facility.state}</span>
            <span style={{ color: "var(--fg-mute)" }}>·</span>
            <span style={{ fontFamily: "var(--mono)" }}>{facility.distance_km.toFixed(1)}km</span>
          </div>
        </div>
        <div className="drawer-body">
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Trust badge · 4 dimensions</span>
              <span className="line" />
            </div>
            <div className="trust-detail">
              <TrustBadge trust={facility.trust} size="lg" showLabel />
              <div className="trust-dim-list">
                {dims.map((d) => (
                  <div key={d.lbl} className="trust-dim-row">
                    <span className="lbl">{d.lbl}</span>
                    <div className="bar"><div className="fill" style={{ width: `${(d.val / d.max) * 100}%` }} /></div>
                    <span className="num">{d.val}/{d.max}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Capability verdicts · jury</span>
              <span className="line" />
            </div>
            <div className="capabilities-grid">
              {facility.capabilities.map((c, i) => (
                <div key={i} className="cap-row">
                  <span className="cap-name">{c.name}</span>
                  <span className="agree">{c.agree}</span>
                  <span className={"jury-verdict-pill " + (c.verdict === "supported" ? "" : c.verdict)}>
                    {c.verdict}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Description · citations highlighted</span>
              <span className="line" />
            </div>
            <div className="description-block">
              {segments.map((s, i) =>
                s.type === "mark" ? (
                  <mark key={i} className={s.id === citationId ? "spotlight" : ""}>
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                )
              )}
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-h">
              <span className="label">Raw row · delta.silver.facilities</span>
              <span className="line" />
            </div>
            <RawRowCollapse facility={facility} />
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Mount in `frontend/app/layout.tsx`**

After `<TopBar />`, add:
```tsx
<FacilityDrawer />
```
Import: `import { FacilityDrawer } from "@/components/drawer/FacilityDrawer";`.

- [ ] **Step 4: Verify**

Visit `localhost:3000?facility=F-MZN-0214` — drawer should slide in.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/drawer/ frontend/app/layout.tsx
git commit -m "feat(frontend): FacilityDrawer with URL-param open state and citation highlighting"
```

---

## Task 11: Splash screen

**Why:** First impression. Display-serif headline, animated 240-pin India SVG, pulsing Bihar bullseye.

**Files:**
- Create: `frontend/components/splash/SplashHero.tsx`
- Create: `frontend/components/splash/SplashVisual.tsx`
- Create: `frontend/lib/demo/states-geo.ts` (initial — used here for SVG state paths)
- Overwrite: `frontend/app/page.tsx`

- [ ] **Step 1: Port states stub from `india-geo.js`**

Open `india-geo.js`. Find `STATES` (used by SplashVisual — it has `cx`, `cy`, `path` per state). Create `frontend/lib/demo/states-geo.ts`:

```ts
import type { StateGeo } from "@/lib/types";

// Used by Atlas (rings) — populated in Task 22.
export const STATES_GEO: StateGeo[] = [];

// Splash uses simplified stylized paths (cx, cy, path) — separate export.
export interface SplashState {
  id: string;
  cx: number;
  cy: number;
  path: string;
}
export const SPLASH_STATES: SplashState[] = [
  // Paste the SANJ.STATES array from india-geo.js (id, cx, cy, path strings).
];
```

- [ ] **Step 2: Create `frontend/components/splash/SplashHero.tsx`**

```tsx
import Link from "next/link";

export function SplashHero() {
  return (
    <div className="splash-text">
      <div className="splash-eyebrow">
        <span className="line" />
        <span>Hack-Nation × World Bank · 2026 · Challenge 03</span>
      </div>
      <h1 className="splash-headline">
        Find help.<br />
        <em>Save lives.</em>
      </h1>
      <p className="splash-tag">
        A reasoning layer over 10,053 Indian healthcare facilities — ranked, cited,
        <span style={{ color: "var(--green)" }}> verified</span> by three independent AI judges.
      </p>
      <div className="splash-cta-row">
        <Link className="btn btn-primary" href="/explorer">
          Run the demo query
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7h8M7 3l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <Link className="btn" href="/atlas">Explore the atlas</Link>
        <Link className="btn-ghost btn" href="/methodology">How it works</Link>
      </div>
      <div className="splash-stats">
        <div>
          <div className="splash-stat-num">10,053</div>
          <div className="splash-stat-label">Facilities indexed</div>
        </div>
        <div>
          <div className="splash-stat-num">28</div>
          <div className="splash-stat-label">States / UTs covered</div>
        </div>
        <div>
          <div className="splash-stat-num">3</div>
          <div className="splash-stat-label">Independent judges</div>
        </div>
        <div>
          <div className="splash-stat-num">41</div>
          <div className="splash-stat-label">Capability dimensions</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/components/splash/SplashVisual.tsx`**

Port `components-base.jsx:176-229` to TypeScript with the `SPLASH_STATES` import.

```tsx
"use client";

import { useMemo } from "react";
import { SPLASH_STATES } from "@/lib/demo/states-geo";

interface Pin { id: number; x: number; y: number; delay: number; sz: number }

export function SplashVisual() {
  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    for (let i = 0; i < 240; i++) {
      const s = SPLASH_STATES[Math.floor(Math.random() * SPLASH_STATES.length)];
      out.push({
        id: i,
        x: s.cx + (Math.random() - 0.5) * 60,
        y: s.cy + (Math.random() - 0.5) * 60,
        delay: Math.random() * 1.2,
        sz: Math.random() * 1.5 + 0.8,
      });
    }
    return out;
  }, []);

  return (
    <div className="splash-visual">
      <div className="corner-mark">India · 10,053 indexed</div>
      <svg className="india-svg" viewBox="0 0 1000 800" fill="none" xmlns="http://www.w3.org/2000/svg">
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
          <path key={s.id} d={s.path} fill="url(#india-fill)" stroke="rgba(212,166,97,0.30)" strokeWidth="0.8" />
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
        <circle cx="645" cy="290" r="14" fill="none" stroke="var(--gold)" strokeWidth="1.2" opacity="0.6">
          <animate attributeName="r" from="14" to="36" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="645" cy="290" r="4" fill="var(--gold)" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Overwrite `frontend/app/page.tsx`**

```tsx
import { TopoBg } from "@/components/shell/TopoBg";
import { SplashHero } from "@/components/splash/SplashHero";
import { SplashVisual } from "@/components/splash/SplashVisual";

export default function HomePage() {
  return (
    <div className="splash">
      <TopoBg />
      <div className="splash-canvas">
        <SplashHero />
        <SplashVisual />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify visual**

Visit `localhost:3000`. Splash should render: eyebrow + giant serif headline + italic tag + 3 CTA buttons + 4-stat grid; right side shows India SVG with topographic ellipses, hand-traced state polygons, 240 pins fading in, pulsing Bihar bullseye.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/splash/ frontend/lib/demo/states-geo.ts frontend/app/page.tsx
git commit -m "feat(frontend): Splash screen with animated India SVG"
```

---

## Task 12: Discriminated-union SSE types + parser

**Why:** Foundation for explorer. Replaces the loose `{type, data: Record<string, unknown>}` shape so every render path is type-checked and the partner has a single source of truth.

**Files:**
- Overwrite: `frontend/lib/sse.ts`
- Create: `frontend/tests/unit/sse.test.ts`

- [ ] **Step 1: Create failing test `frontend/tests/unit/sse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { StreamEvent } from "@/lib/sse";
import { isLiveOnlyEvent, parseSSEFrame } from "@/lib/sse";

describe("sse types", () => {
  it("type narrowing: thinking_delta narrows to text", () => {
    const ev: StreamEvent = { type: "thinking_delta", data: { text: "hi" } };
    if (ev.type === "thinking_delta") {
      const t: string = ev.data.text;
      expect(t).toBe("hi");
    }
  });

  it("isLiveOnlyEvent recognizes existing backend events", () => {
    expect(isLiveOnlyEvent("thinking_delta")).toBe(true);
    expect(isLiveOnlyEvent("agent_step_start")).toBe(true);
    expect(isLiveOnlyEvent("tool_call")).toBe(true);
    expect(isLiveOnlyEvent("model_proposal")).toBe(false);
    expect(isLiveOnlyEvent("consensus_resolved")).toBe(false);
    expect(isLiveOnlyEvent("validator_pass")).toBe(false);
    expect(isLiveOnlyEvent("recommendations_ready")).toBe(false);
  });

  it("parseSSEFrame returns null for malformed", () => {
    expect(parseSSEFrame("comment line")).toBeNull();
    expect(parseSSEFrame("data: {malformed")).toBeNull();
  });

  it("parseSSEFrame returns event for valid frame", () => {
    const ev = parseSSEFrame('data: {"type":"text_delta","data":{"text":"x"}}');
    expect(ev).toEqual({ type: "text_delta", data: { text: "x" } });
  });
});
```

```bash
cd frontend && npm run test
```
Expected: FAIL — symbols not exported.

- [ ] **Step 2: Overwrite `frontend/lib/sse.ts`**

```ts
import type { RecommendedFacility, ExcludedFacility, Verdict } from "@/lib/types";

export type StreamEvent =
  | { type: "thinking_delta"; data: { text: string } }
  | { type: "agent_step_start"; data: { step_id: string; name: string; label: string } }
  | { type: "agent_step_end"; data: { step_id: string; name: string; summary?: string; duration_ms?: number } }
  | { type: "tool_call"; data: { tool: string; input?: Record<string, unknown>; output_summary?: string; duration_ms?: number } }
  | { type: "model_proposal"; data: { proposer_id: "A" | "B"; vendor: string; title: string; text: string } }
  | { type: "consensus_resolved"; data: ConsensusResolvedData }
  | { type: "validator_pass"; data: { title: string; body: string; passed: boolean } }
  | { type: "text_delta"; data: { text: string } }
  | { type: "citation"; data: { citation_id: string; facility_id: string; column: string; char_start: number; char_end: number; excerpt: string } }
  | { type: "recommendations_ready"; data: { facilities: RecommendedFacility[]; excluded: ExcludedFacility[]; pipeline_ms: number; candidates_considered: number } }
  | { type: "error"; data: { message: string } };

export interface ConsensusResolvedData {
  claim: string;
  title?: string;
  verdict: Verdict;
  agreement: 0 | 1 | 2 | 3;
  dissent: boolean;
  judges: Array<{
    name: string;
    vendor: string;
    verdict: Verdict;
    confidence: number;
    excerpt: string;
    dissent_note?: string;
  }>;
  tiebreaker?: { model: string; verdict: Verdict; reasoning: string };
}

export type StreamEventType = StreamEvent["type"];

const LIVE_ONLY_TYPES: ReadonlySet<StreamEventType> = new Set([
  "thinking_delta",
  "agent_step_start",
  "agent_step_end",
  "tool_call",
  "text_delta",
  "citation",
  "error",
]);

export function isLiveOnlyEvent(t: StreamEventType): boolean {
  return LIVE_ONLY_TYPES.has(t);
}

export function parseSSEFrame(frame: string): StreamEvent | null {
  if (!frame.startsWith("data: ")) return null;
  const json = frame.slice(6);
  try {
    return JSON.parse(json) as StreamEvent;
  } catch {
    return null;
  }
}

export async function* streamQuery(query: string): AsyncGenerator<StreamEvent> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const resp = await fetch(`${apiUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseSSEFrame(frame);
      if (ev) yield ev;
    }
  }
}
```

- [ ] **Step 3: Run test**

```bash
cd frontend && npm run test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/sse.ts frontend/tests/unit/sse.test.ts
git commit -m "feat(frontend): discriminated-union SSE event types"
```

---

## Task 13: Demo data — trace, exclusions, hero queries

**Why:** Provides typed baked content for fallback/demo mode.

**Files:**
- Create: `frontend/lib/demo/trace.ts`
- Create: `frontend/lib/demo/exclusions.ts`
- Create: `frontend/lib/demo/hero-queries.ts`

- [ ] **Step 1: Port `data.js` HERO_QUERIES to `frontend/lib/demo/hero-queries.ts`**

```ts
import type { HeroQuery } from "@/lib/types";

export const HERO_QUERIES: HeroQuery[] = [
  // Paste the array from data.js HERO_QUERIES — fields {id, label, text, answerLine}.
];
```

- [ ] **Step 2: Port `data.js` EXCLUSIONS to `frontend/lib/demo/exclusions.ts`**

```ts
import type { ExcludedFacility } from "@/lib/types";

export const EXCLUSIONS: ExcludedFacility[] = [
  // Paste the EXCLUSIONS array from data.js — fields {name, district, type, reason, verdict}.
];
```

- [ ] **Step 3: Port `data.js` TRACE to typed StreamEvent[] in `frontend/lib/demo/trace.ts`**

The source TRACE uses internal types (`{type: "thinking", label, text, dur, t}`, `{type: "agent_step", ...}`, `{type: "jury", ...}`, etc.) — these need translation to wire-format StreamEvent shapes.

```ts
import type { StreamEvent } from "@/lib/sse";

export interface TimedEvent {
  ev: StreamEvent;
  delay_ms: number; // ms after start when this event fires
}

export const DEMO_TRACE: TimedEvent[] = [
  // Translate each TRACE entry from data.js. Mappings:
  // {type:"thinking",label,text,dur,t}      → {type:"thinking_delta", data:{text}} delivered character-stream style
  //                                           For simplicity, deliver as a single thinking_delta at offset t.
  // {type:"agent_step",label,title,body,t}  → start at t, end at t+200ms
  //                                           {type:"agent_step_start", data:{step_id, name:label, label}} at t
  //                                           {type:"agent_step_end",   data:{step_id, name:label, summary:title}} at t+200
  // {type:"tool_call",label,title,out,t}    → {type:"tool_call", data:{tool:label, output_summary:out}} at t
  // {type:"proposals",label,proposals,t}    → emit one model_proposal per proposer (id "A","B"), at t and t+50
  // {type:"jury",...,t}                     → {type:"consensus_resolved", data:{...}} at t
  // {type:"validator",label,title,body,t}   → {type:"validator_pass", data:{title, body, passed:true}} at t
  // {type:"answer_ready",label,title,t}     → noop or final RecommendationsReady at t (combined with text + recommendations)

  // Engineer: use the source's TRACE timing values as delay_ms; populate fields
  // from the source verbatim. End the sequence with a recommendations_ready event
  // payload built from FACILITIES + EXCLUSIONS.
];
```

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/demo/trace.ts frontend/lib/demo/exclusions.ts frontend/lib/demo/hero-queries.ts
git commit -m "feat(frontend): port baked demo trace, exclusions, hero queries"
```

---

## Task 14: useEventStream hook with live + fallback merge

**Why:** Core of the explorer. Yields live events as they arrive and synthesizes missing ones from `DEMO_TRACE` after timeout.

**Files:**
- Create: `frontend/lib/hooks/use-event-stream.ts`
- Create: `frontend/tests/unit/use-event-stream.test.ts`

- [ ] **Step 1: Create failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock streamQuery to yield a few live events
const mockStreamQuery = vi.fn();
vi.mock("@/lib/sse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sse")>("@/lib/sse");
  return { ...actual, streamQuery: mockStreamQuery };
});

import { useEventStream } from "@/lib/hooks/use-event-stream";

describe("useEventStream", () => {
  beforeEach(() => {
    mockStreamQuery.mockReset();
  });

  it("yields live events from backend", async () => {
    mockStreamQuery.mockImplementation(async function* () {
      yield { type: "thinking_delta", data: { text: "hi" } };
      yield { type: "text_delta", data: { text: "ok" } };
    });

    const { result } = renderHook(() => useEventStream());
    act(() => { result.current.run("test"); });

    await waitFor(() => {
      expect(result.current.events.length).toBeGreaterThanOrEqual(2);
    });
    expect(result.current.events[0]?.type).toBe("thinking_delta");
  });

  it("appends demo fallback when backend never emits jury", async () => {
    mockStreamQuery.mockImplementation(async function* () {
      yield { type: "text_delta", data: { text: "answer" } };
    });

    const { result } = renderHook(() => useEventStream({ fallbackTimeoutMs: 50 }));
    act(() => { result.current.run("test"); });

    await waitFor(
      () => {
        const types = result.current.events.map((e) => e.type);
        expect(types).toContain("consensus_resolved");
      },
      { timeout: 2000 }
    );
  });
});
```

```bash
cd frontend && npm run test
```
Expected: FAIL — useEventStream not defined.

- [ ] **Step 2: Create `frontend/lib/hooks/use-event-stream.ts`**

```ts
"use client";

import { useCallback, useRef, useState } from "react";
import { streamQuery, type StreamEvent, type StreamEventType } from "@/lib/sse";
import { DEMO_TRACE } from "@/lib/demo/trace";

export interface TaggedEvent {
  __source: "live" | "demo";
  ev: StreamEvent;
}

export interface UseEventStreamOptions {
  fallbackTimeoutMs?: number;
  forceDemo?: boolean; // ?demo=1
  speed?: number; // 1 = normal
}

export interface UseEventStreamReturn {
  events: TaggedEvent[];
  running: boolean;
  run: (query: string) => Promise<void>;
}

const FALLBACK_REQUIRED_TYPES: StreamEventType[] = [
  "model_proposal",
  "consensus_resolved",
  "validator_pass",
  "recommendations_ready",
];

export function useEventStream(opts: UseEventStreamOptions = {}): UseEventStreamReturn {
  const { fallbackTimeoutMs = 8000, forceDemo = false, speed = 1 } = opts;
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [running, setRunning] = useState(false);
  const seenTypes = useRef<Set<StreamEventType>>(new Set());

  const run = useCallback(
    async (query: string) => {
      setRunning(true);
      setEvents([]);
      seenTypes.current = new Set();

      const append = (ev: StreamEvent, source: "live" | "demo") => {
        seenTypes.current.add(ev.type);
        setEvents((prev) => [...prev, { __source: source, ev }]);
      };

      const playDemoFallback = () => {
        const baseT = performance.now();
        for (const { ev, delay_ms } of DEMO_TRACE) {
          if (FALLBACK_REQUIRED_TYPES.includes(ev.type) && seenTypes.current.has(ev.type)) {
            continue; // backend already provided this type
          }
          const t = (delay_ms / speed) - (performance.now() - baseT);
          setTimeout(() => append(ev, "demo"), Math.max(0, t));
        }
      };

      if (forceDemo) {
        playDemoFallback();
        setRunning(false);
        return;
      }

      try {
        const timeout = setTimeout(playDemoFallback, fallbackTimeoutMs);
        for await (const ev of streamQuery(query)) {
          append(ev, "live");
        }
        clearTimeout(timeout);
        // After live stream ends, emit fallback for any missing required type
        const missing = FALLBACK_REQUIRED_TYPES.filter((t) => !seenTypes.current.has(t));
        if (missing.length > 0) playDemoFallback();
      } catch (e) {
        append(
          { type: "error", data: { message: e instanceof Error ? e.message : "stream failed" } },
          "live"
        );
        playDemoFallback();
      } finally {
        setRunning(false);
      }
    },
    [fallbackTimeoutMs, forceDemo, speed]
  );

  return { events, running, run };
}
```

- [ ] **Step 3: Run test**

```bash
cd frontend && npm run test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/hooks/use-event-stream.ts frontend/tests/unit/use-event-stream.test.ts
git commit -m "feat(frontend): useEventStream with live + demo fallback merge"
```

---

## Task 15: Trace event renderers (Thinking, AgentStep, ToolCall, Proposals, Validator, AnswerReady)

**Why:** Each event type needs its own visual treatment per the design.

**Files:**
- Create: `frontend/components/trace/{ThinkingNode,AgentStepNode,ToolCallNode,ProposalsNode,ValidatorNode,AnswerReadyNode}.tsx`

- [ ] **Step 1: Port each component from `components-explorer.jsx`**

For each renderer, copy from the source line ranges and convert to TypeScript. Each accepts `{ event: StreamEvent extends type X; finished: boolean }`.

- `ThinkingNode.tsx` — port lines 7-38. Typewriter effect over `event.data.text`. Accepts `{event: Extract<StreamEvent, {type:"thinking_delta"}>}`.
- `AgentStepNode.tsx` — port lines 40-49. Renders for both `agent_step_start` (spinner) and `agent_step_end` (checkmark). Pair them by `step_id`.
- `ToolCallNode.tsx` — port lines 51-60. Mono-typeset.
- `ProposalsNode.tsx` — port lines 62-78. Side-by-side cards, one per proposer.
- `ValidatorNode.tsx` — port lines 80-89.
- `AnswerReadyNode.tsx` — port lines 91-99.

Each file is short (~30 LOC). Keep className strings exactly as in source.

(Engineer: do these one at a time. Run `npx tsc --noEmit` after each.)

- [ ] **Step 2: Commit after all six exist**

```bash
git add frontend/components/trace/
git commit -m "feat(frontend): trace event renderers (thinking/agent_step/tool/proposals/validator/answer)"
```

---

## Task 16: JuryPanel component

**Why:** The signature wow moment of the demo. Earns its own task because of the agreement bar animation, dissent column, and tiebreaker row.

**Files:**
- Create: `frontend/components/trace/JuryPanel.tsx`

- [ ] **Step 1: Create `frontend/components/trace/JuryPanel.tsx`**

Port `components-explorer.jsx:104-174` to TypeScript with `Extract<StreamEvent, {type:"consensus_resolved"}>` typing. Code is largely 1-to-1 from the source — preserve `style={{...}}` literals and class names as-is. The `dissentSegs` calculation uses `3 - event.data.agreement` — type is exact since `agreement: 0|1|2|3`.

Reference the source code shown in Section 2 of the spec; adapt to read fields from `event.data` instead of the source's `event` directly.

- [ ] **Step 2: Verify**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/trace/JuryPanel.tsx
git commit -m "feat(frontend): JuryPanel with agreement bar + dissent + tiebreaker"
```

---

## Task 17: TraceStream + TraceEvent router

**Why:** Glue that takes typed events from `useEventStream` and dispatches to the right renderer.

**Files:**
- Create: `frontend/components/trace/TraceEvent.tsx`
- Create: `frontend/components/trace/TraceStream.tsx`

- [ ] **Step 1: Create `frontend/components/trace/TraceEvent.tsx`**

```tsx
import type { StreamEvent } from "@/lib/sse";
import { ThinkingNode } from "./ThinkingNode";
import { AgentStepNode } from "./AgentStepNode";
import { ToolCallNode } from "./ToolCallNode";
import { ProposalsNode } from "./ProposalsNode";
import { JuryPanel } from "./JuryPanel";
import { ValidatorNode } from "./ValidatorNode";
import { AnswerReadyNode } from "./AnswerReadyNode";

interface TraceEventProps {
  event: StreamEvent;
  finished: boolean;
}

export function TraceEvent({ event, finished }: TraceEventProps) {
  switch (event.type) {
    case "thinking_delta":      return <ThinkingNode event={event} finished={finished} />;
    case "agent_step_start":    return <AgentStepNode event={event} finished={false} />;
    case "agent_step_end":      return <AgentStepNode event={event} finished={true} />;
    case "tool_call":           return <ToolCallNode event={event} finished={finished} />;
    case "model_proposal":      return <ProposalsNode event={event} />;
    case "consensus_resolved":  return <JuryPanel event={event} />;
    case "validator_pass":      return <ValidatorNode event={event} />;
    case "text_delta":          return null; // rendered in main column, not trace
    case "citation":            return null; // rendered inline
    case "recommendations_ready": return <AnswerReadyNode event={event} />;
    case "error":               return <ValidatorNode event={{ type: "validator_pass", data: { title: "Error", body: event.data.message, passed: false } }} />;
  }
}
```

(If TS complains about the `error` branch: keep the dedicated ErrorNode if you'd rather — the cast above is a quick reuse; cleaner is a tiny `ErrorNode` component.)

- [ ] **Step 2: Create `frontend/components/trace/TraceStream.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { TraceEvent } from "./TraceEvent";
import type { TaggedEvent } from "@/lib/hooks/use-event-stream";

interface TraceStreamProps {
  events: TaggedEvent[];
  totalExpected?: number;
}

export function TraceStream({ events, totalExpected }: TraceStreamProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);

  return (
    <div className="trace-panel">
      <div className="trace-head">
        <h3>
          <span className="live-dot" />
          Agent Trace
        </h3>
        <span className="meta">
          SSE · {events.length}{totalExpected ? `/${totalExpected}` : ""}
        </span>
      </div>
      <div className="trace-stream" ref={ref}>
        {events.map((te, i) => (
          <TraceEvent key={i} event={te.ev} finished={i < events.length - 1} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/trace/TraceEvent.tsx frontend/components/trace/TraceStream.tsx
git commit -m "feat(frontend): TraceStream + polymorphic TraceEvent router"
```

---

## Task 18: Explorer main column components

**Why:** QueryBlock, AnswerProse, RecommendationCard, ReasonLine, WhyNotThese — the left side of the Explorer.

**Files:**
- Create: `frontend/components/explorer/{QueryBlock,AnswerProse,RecommendationCard,ReasonLine,WhyNotThese,ResultEyebrow}.tsx`

- [ ] **Step 1: ResultEyebrow** (small reusable label)

```tsx
export function ResultEyebrow({ label, count }: { label: string; count?: string | number }) {
  return (
    <div className="result-eyebrow">
      <span>{label}</span>
      <span className="line" />
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  );
}
```

- [ ] **Step 2: QueryBlock** — port `components-explorer.jsx:366-386` (the `query-block` div)

Accept props `{activeQueryId, onQueryChange, onReplay}`. Render the search icon, readonly input bound to `HERO_QUERIES.find(q=>q.id===activeQueryId).text`, and the suggestion chips iterating `HERO_QUERIES`.

- [ ] **Step 3: AnswerProse** — display-serif paragraph

Accept `{children}`. Wraps in `<p className="answer-prose">`.

- [ ] **Step 4: RecommendationCard** — port `components-explorer.jsx:236-265`

Accepts `{facility: RecommendedFacility, rank: number, onCitationClick}`. The `onClick` on the outer div opens the drawer (use `useDrawer().openDrawer(facility.id)`).

- [ ] **Step 5: ReasonLine** — port `components-explorer.jsx:267-306`

Three-branch switch on `facility.id`. Each branch returns a JSX span with embedded `<CitationPill>`s pulled from `facility.citations`.

- [ ] **Step 6: WhyNotThese** — port `components-explorer.jsx:311-345`

Local `useState<boolean>` for collapse. Reads `EXCLUSIONS` from `lib/demo/exclusions`.

- [ ] **Step 7: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add frontend/components/explorer/
git commit -m "feat(frontend): explorer main-column components"
```

---

## Task 19: Explorer page assembly

**Why:** Pulls everything together at `/explorer`.

**Files:**
- Create: `frontend/app/explorer/page.tsx`

- [ ] **Step 1: Create `frontend/app/explorer/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TopoBg } from "@/components/shell/TopoBg";
import { QueryBlock } from "@/components/explorer/QueryBlock";
import { ResultEyebrow } from "@/components/explorer/ResultEyebrow";
import { AnswerProse } from "@/components/explorer/AnswerProse";
import { RecommendationCard } from "@/components/explorer/RecommendationCard";
import { WhyNotThese } from "@/components/explorer/WhyNotThese";
import { TraceStream } from "@/components/trace/TraceStream";
import { useEventStream } from "@/lib/hooks/use-event-stream";
import { useDrawer } from "@/lib/hooks/use-drawer";
import { HERO_QUERIES } from "@/lib/demo/hero-queries";
import { FACILITIES, HERO_FACILITY_IDS } from "@/lib/demo/facilities";
import type { FacilityCitation } from "@/lib/types";

export default function ExplorerPage() {
  const searchParams = useSearchParams();
  const forceDemo = searchParams.get("demo") === "1";
  const speed = Number(searchParams.get("speed") ?? "1");

  const [activeQueryId, setActiveQueryId] = useState(HERO_QUERIES[0]?.id ?? "");
  const { events, run } = useEventStream({ forceDemo, speed });
  const { openDrawer } = useDrawer();

  const activeQuery = HERO_QUERIES.find((q) => q.id === activeQueryId) ?? HERO_QUERIES[0];

  useEffect(() => {
    if (activeQuery) run(activeQuery.text);
  }, [activeQueryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const facilities = HERO_FACILITY_IDS.map((id) => FACILITIES[id]);

  // Look for recommendations_ready in events; otherwise use baked HERO_FACILITY_IDS
  const recsEvent = events.find((te) => te.ev.type === "recommendations_ready");
  const liveFacilities = recsEvent && recsEvent.ev.type === "recommendations_ready"
    ? recsEvent.ev.data.facilities
    : facilities;

  const onCitationClick = (facilityId: string, citation: FacilityCitation) => {
    openDrawer(facilityId, citation.id);
  };

  return (
    <div className="explorer">
      <TopoBg />
      <div className="explorer-main">
        <QueryBlock
          activeQueryId={activeQueryId}
          onQueryChange={setActiveQueryId}
          onReplay={() => run(activeQuery!.text)}
        />
        <div className="result-section">
          <ResultEyebrow label="Synthesized answer" count={`${liveFacilities.length} verified`} />
          <AnswerProse>{activeQuery?.answerLine}</AnswerProse>
          <ResultEyebrow label="Ranked recommendations" />
          {liveFacilities.map((f, i) => (
            <RecommendationCard
              key={f.id}
              facility={f}
              rank={i + 1}
              onCitationClick={onCitationClick}
            />
          ))}
          <WhyNotThese />
          <div
            style={{
              marginTop: 28,
              fontSize: 12,
              color: "var(--fg-mute)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.05em",
              textAlign: "center",
            }}
          >
            All claims sourced from delta.silver.facilities · jury verdicts from gold.capability_verdicts
          </div>
        </div>
      </div>
      <TraceStream events={events} />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

`localhost:3000/explorer` — left column shows query block, suggestion chips, answer prose, 3 recommendation cards with trust badges, why-not-these collapse. Right column shows trace events streaming in as the demo fallback fires.

Hover a citation pill — tooltip appears with highlighted excerpt. Click it — drawer opens scrolled to spotlight.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/explorer/page.tsx
git commit -m "feat(frontend): Explorer page assembled with live + demo trace"
```

---

## Task 20: lib/maps/geo-utils with tests

**Why:** Pure functions used by maplibre-setup. TDD because they're math-y.

**Files:**
- Create: `frontend/lib/maps/geo-utils.ts`
- Create: `frontend/tests/unit/geo-utils.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { centroidLngLat, bboxLngLat, gapColor } from "@/lib/maps/geo-utils";

describe("geo-utils", () => {
  it("centroidLngLat averages a single ring", () => {
    const ring: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(centroidLngLat([ring])).toEqual([5, 5]);
  });

  it("bboxLngLat returns extremes", () => {
    const ring: Array<[number, number]> = [[80, 22], [85, 24], [82, 26]];
    expect(bboxLngLat([ring])).toEqual({ mnLng: 80, mxLng: 85, mnLat: 22, mxLat: 26 });
  });

  it("gapColor returns green for low gap", () => {
    expect(gapColor(0.0)).toMatch(/^#34/);
    expect(gapColor(0.95)).toMatch(/^#C/);
  });
});
```

```bash
cd frontend && npm run test
```
Expected: FAIL.

- [ ] **Step 2: Create `frontend/lib/maps/geo-utils.ts`**

Port the equivalent functions from `india-geo.js` (the file's bottom section has `centroidLngLat` and `bboxLngLat` helpers, and `components-atlas.jsx:44-50` has `gapColor`).

```ts
type Ring = Array<[number, number]>;

export function centroidLngLat(rings: Ring[]): [number, number] {
  let sumX = 0, sumY = 0, count = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  return [sumX / count, sumY / count];
}

export function bboxLngLat(rings: Ring[]) {
  let mnLng = Infinity, mxLng = -Infinity, mnLat = Infinity, mxLat = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < mnLng) mnLng = x;
      if (x > mxLng) mxLng = x;
      if (y < mnLat) mnLat = y;
      if (y > mxLat) mxLat = y;
    }
  }
  return { mnLng, mxLng, mnLat, mxLat };
}

export function gapColor(g: number): string {
  if (g < 0.3) return "#34C58A";
  if (g < 0.5) return "#7DB87A";
  if (g < 0.65) return "#BFA46A";
  if (g < 0.8) return "#C07D4A";
  return "#C04A3F";
}
```

- [ ] **Step 3: Run test**

```bash
cd frontend && npm run test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/maps/geo-utils.ts frontend/tests/unit/geo-utils.test.ts
git commit -m "feat(frontend): map geo utils (centroid, bbox, gapColor)"
```

---

## Task 21: lib/demo districts + capability-bias + populate states-geo rings

**Files:**
- Modify: `frontend/lib/demo/states-geo.ts`
- Create: `frontend/lib/demo/districts-geo.ts`
- Create: `frontend/lib/demo/capability-bias.ts`

- [ ] **Step 1: Populate `STATES_GEO` with rings**

In `india-geo.js` find the `STATES_GEO` array — each entry has `{id, name, abbr, capital, rings: [[[lng, lat], ...]]}`. Paste verbatim into `STATES_GEO` in `frontend/lib/demo/states-geo.ts`.

- [ ] **Step 2: Create `frontend/lib/demo/districts-geo.ts`**

```ts
import type { DistrictPoint } from "@/lib/types";
export const DISTRICTS_GEO: DistrictPoint[] = [
  // Paste from india-geo.js DISTRICTS_GEO — each {id, name, state, pop, facs, verified, gap, lng, lat}.
];
export const STATE_ID_OF: Record<string, string> = {
  // Paste from india-geo.js STATE_ID_OF — maps "Bihar" -> "BR" etc.
};
```

- [ ] **Step 3: Create `frontend/lib/demo/capability-bias.ts`**

```ts
import type { CapabilityDef } from "@/lib/types";

export const CAPABILITIES: CapabilityDef[] = [
  // Paste from data.js CAPABILITIES — {id, label}.
];

export const CAP_BIAS: Record<string, Record<string, number>> = {
  // Paste from data.js CAP_BIAS — {capability_id: {state_id: multiplier}}.
};
```

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/demo/states-geo.ts frontend/lib/demo/districts-geo.ts frontend/lib/demo/capability-bias.ts
git commit -m "feat(frontend): port states/districts/capability-bias demo data"
```

---

## Task 22: lib/maps/maplibre-setup — layer factories

**Why:** Source/layer creation extracted from the Atlas component for testability and clarity.

**Files:**
- Create: `frontend/lib/maps/maplibre-setup.ts`

- [ ] **Step 1: Create `frontend/lib/maps/maplibre-setup.ts`**

Extract the GeoJSON construction (`components-atlas.jsx:7-31`), `computeStateGaps` (`52-67`), `makeCircle` and `addImage` setup (`205-232`), and the layer-add definitions (`148-327`). Expose:

```ts
import type { Map as MLMap } from "maplibre-gl";
import { STATES_GEO } from "@/lib/demo/states-geo";
import { DISTRICTS_GEO, STATE_ID_OF } from "@/lib/demo/districts-geo";
import { CAP_BIAS } from "@/lib/demo/capability-bias";
import { centroidLngLat } from "./geo-utils";

export function buildStatesGeoJSON() { /* ... */ }
export function buildDistrictsGeoJSON() { /* ... */ }
export function computeStateGaps(capability: string): Record<string, number> { /* ... */ }
export function enrichStates(capability: string) { /* deep clone + .gap = ... */ }
export function enrichDistricts(capability: string) { /* deep clone + .gapAdj = ... */ }
export function buildStateCentroidsGeoJSON() { /* uses centroidLngLat */ }
export function setupLayers(map: MLMap, opts: { initialDistrictId?: string }) {
  // adds all sources, makeCircle images, layers (state-fill, state-line, state-highlight,
  // state-desert-line, district-circle, district-selected, district-label, state-label).
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/maps/maplibre-setup.ts
git commit -m "feat(frontend): maplibre source + layer factories"
```

---

## Task 23: AtlasMap component (dynamic-imported)

**Why:** Wraps MapLibre. Owns the `useEffect` for map init, hover state, click handlers, capability/layer effects.

**Files:**
- Create: `frontend/components/atlas/AtlasMap.tsx`

- [ ] **Step 1: Create `frontend/components/atlas/AtlasMap.tsx`**

Port `components-atlas.jsx:72-404` (Atlas function up to the `return` statement) — but receive props `{capability, selectedDistrictId, onDistrictSelect, onStateFocus, onHover, layers}` instead of using local state for these. The Atlas page (Task 26) owns the URL state.

Use `import maplibregl from "maplibre-gl"; import "maplibre-gl/dist/maplibre-gl.css";` at the top — note the CSS import is required.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/atlas/AtlasMap.tsx
git commit -m "feat(frontend): AtlasMap component encapsulating maplibre lifecycle"
```

---

## Task 24: Atlas chrome — Segmented, LayerToggles, Search, Legend, Breadcrumb, Tooltip

**Files:**
- Create: `frontend/components/atlas/{CapabilitySegmented,LayerToggles,AtlasSearch,AtlasLegend,AtlasBreadcrumb,AtlasTooltip}.tsx`

- [ ] **Step 1: Port each from `components-atlas.jsx`**

| Component | Source range |
|---|---|
| `CapabilitySegmented` | 489-498 |
| `LayerToggles` | 522-540 |
| `AtlasSearch` | 502-521 (with the `searchResults` memo extracted into the component) |
| `AtlasLegend` | 545-555 |
| `AtlasBreadcrumb` | 558-565 |
| `AtlasTooltip` | 568-592 |

Each becomes a typed component with explicit props. Use `lib/types.ts` types for hover info.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/atlas/CapabilitySegmented.tsx frontend/components/atlas/LayerToggles.tsx frontend/components/atlas/AtlasSearch.tsx frontend/components/atlas/AtlasLegend.tsx frontend/components/atlas/AtlasBreadcrumb.tsx frontend/components/atlas/AtlasTooltip.tsx
git commit -m "feat(frontend): atlas chrome components (segmented, layers, search, legend, breadcrumb, tooltip)"
```

---

## Task 25: DistrictDrillDown component

**Files:**
- Create: `frontend/components/atlas/DistrictDrillDown.tsx`

- [ ] **Step 1: Port `components-atlas.jsx:603-683`**

Accept `{district: DistrictPoint, capability: CapabilityDef["id"]}`. Use the FACILITIES lookup for the "best-trust facilities" rows. Use `useDrawer().openDrawer` on click.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/atlas/DistrictDrillDown.tsx
git commit -m "feat(frontend): DistrictDrillDown panel"
```

---

## Task 26: Atlas page assembly

**Files:**
- Create: `frontend/app/atlas/page.tsx`

- [ ] **Step 1: Create `frontend/app/atlas/page.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CapabilitySegmented } from "@/components/atlas/CapabilitySegmented";
import { LayerToggles } from "@/components/atlas/LayerToggles";
import { AtlasSearch } from "@/components/atlas/AtlasSearch";
import { AtlasLegend } from "@/components/atlas/AtlasLegend";
import { AtlasBreadcrumb } from "@/components/atlas/AtlasBreadcrumb";
import { AtlasTooltip } from "@/components/atlas/AtlasTooltip";
import { DistrictDrillDown } from "@/components/atlas/DistrictDrillDown";
import { DISTRICTS_GEO } from "@/lib/demo/districts-geo";
import type { CapabilityDef } from "@/lib/types";

const AtlasMap = dynamic(
  () => import("@/components/atlas/AtlasMap").then((m) => m.AtlasMap),
  { ssr: false, loading: () => <div className="atlas-map-container" /> }
);

export default function AtlasPage() {
  const [capability, setCapability] = useState<CapabilityDef["id"]>("emergency");
  const [selectedDistrictId, setSelectedDistrictId] = useState("MZN");
  const [focusedState, setFocusedState] = useState<string | null>(null);
  const [layers, setLayers] = useState({ choropleth: true, pins: true, labels: true, deserts: true });
  const [hover, setHover] = useState<null | { x: number; y: number; /* ... */ }>(null);

  const selDistrict = DISTRICTS_GEO.find((d) => d.id === selectedDistrictId) ?? DISTRICTS_GEO[0]!;

  return (
    <div className="atlas">
      <div className="atlas-stage">
        <AtlasMap
          capability={capability}
          selectedDistrictId={selectedDistrictId}
          onDistrictSelect={setSelectedDistrictId}
          onStateFocus={setFocusedState}
          onHover={setHover}
          layers={layers}
        />
        <div className="atlas-controls">
          <CapabilitySegmented value={capability} onChange={setCapability} />
        </div>
        <div className="atlas-rightcol">
          <AtlasSearch onPick={(r) => { /* fly to */ }} />
          <LayerToggles value={layers} onChange={setLayers} />
        </div>
        <AtlasLegend capability={capability} />
        {focusedState && (
          <AtlasBreadcrumb stateId={focusedState} onReset={() => setFocusedState(null)} />
        )}
        {hover && <AtlasTooltip {...hover} />}
      </div>
      <DistrictDrillDown district={selDistrict} capability={capability} />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

`localhost:3000/atlas`. Map renders. Capability segmented control switches choropleth colors. Layer toggles work. Click state → fly-to + breadcrumb. Click district → drilldown updates.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/atlas/page.tsx
git commit -m "feat(frontend): Atlas page with maplibre + chrome assembled"
```

---

## Task 27: Methodology page

**Files:**
- Create: `frontend/app/methodology/page.tsx`

- [ ] **Step 1: Port `components-atlas.jsx:825-879`**

Server component. Static prose + 4 pipeline cards + 3 judge cards. No client interactivity needed.

```tsx
import { TopoBg } from "@/components/shell/TopoBg";

export default function MethodologyPage() {
  return (
    <div className="about">
      <TopoBg />
      <div className="about-inner">
        {/* paste verbatim, converted to JSX */}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

`localhost:3000/methodology` — renders all sections cleanly.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/methodology/page.tsx
git commit -m "feat(frontend): Methodology page"
```

---

## Task 28: Delete old Chat component

**Files:**
- Delete: `frontend/components/chat/Chat.tsx`
- Delete: `frontend/components/chat/` (if empty)

- [ ] **Step 1: Verify no references**

```bash
cd frontend && npx tsc --noEmit
grep -r "from.*chat/Chat" .
```
Should return 0 hits (we replaced page.tsx earlier).

- [ ] **Step 2: Delete**

```bash
rm -rf frontend/components/chat
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(frontend): remove old Chat component"
```

---

## Task 29: Demo-source dev pill (Polish)

**Why:** During development, mark events that came from the demo fallback so the team can see what backend is/isn't emitting.

**Files:**
- Modify: `frontend/components/trace/TraceStream.tsx`

- [ ] **Step 1: Add demo badge**

In the `events.map` render, when `te.__source === "demo"` and `process.env.NODE_ENV === "development"`, render a small gold pill alongside the event. Keep the badge styled inline so it doesn't pollute styles.css.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/trace/TraceStream.tsx
git commit -m "feat(frontend): dev-only demo source pill on trace events"
```

---

## Task 30: Accessibility pass

**Files:**
- Modify: `frontend/components/trace/TraceStream.tsx`
- Modify: `frontend/components/splash/SplashVisual.tsx`
- Modify: `frontend/app/explorer/page.tsx`

- [ ] **Step 1: Add `aria-live="polite"` to `.trace-stream`** so screen readers announce new events.

- [ ] **Step 2: Add `<title>` and `<desc>` to `SplashVisual` SVG** describing the India map + animated pins.

- [ ] **Step 3: Add visible `:focus-visible` outlines** for query input and citation pills (a tokens.css addition: `*:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }`).

- [ ] **Step 4: Verify with Lighthouse**

Run Lighthouse on `/explorer`. Aim for accessibility ≥ 90.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): a11y pass — aria-live, svg titles, focus-visible"
```

---

## Task 31: SSE event contract handoff doc

**Files:**
- Create: `docs/sse-event-contract.md`

- [ ] **Step 1: Write the doc**

Mirror `frontend/lib/sse.ts` as Markdown. For each event type, include: name, when emitted, JSON schema example, mapping to backend node (cross-reference `docs/OVERVIEW.md` §5.3 stages).

Include a "Demo fallback" section listing which event types are currently demo-stubbed and what shape the backend partner should emit.

- [ ] **Step 2: Commit**

```bash
git add docs/sse-event-contract.md
git commit -m "docs: SSE event contract for backend handoff"
```

---

## Task 32: Final verification — full demo walkthrough

**No file changes. Verification only.**

- [ ] **Step 1: Type-check + tests + build**

```bash
cd frontend
npx tsc --noEmit
npm run test
npm run lint
npm run build
```
All four must pass cleanly.

- [ ] **Step 2: Dev server golden path**

```bash
cd frontend && npm run dev
```

Walk through:

1. `/` — splash renders, headline + 240 pins + Bihar bullseye + 3 CTA `<Link>`s navigate correctly.
2. Click "Run the demo query" → `/explorer`. Trace stream populates with the baked sequence (thinking → agent_step → tool_call → proposals → jury → validator → answer_ready). Hovering a citation pill in any rec card shows the tooltip with highlighted excerpt.
3. Click a citation pill → URL gains `?facility=…&citation=…`, FacilityDrawer slides in scrolled to the spotlighted `<mark>`. Close button restores URL.
4. Navigate to `/atlas`. MapLibre loads, India choropleth renders with green→amber→red gradient. Click "Neonatal" segment → choropleth recolors. Click Bihar state → fly-to, breadcrumb appears, drilldown updates. Click a district pin → drilldown updates. Search "Muzaffarpur" → flies to district.
5. Click drawer link from any recommendation in the drilldown — drawer opens. Navigate to `/explorer` while drawer open — drawer remains (URL preserved).
6. `/methodology` — static prose renders cleanly, no errors.
7. Add `?demo=1&speed=2` to `/explorer` — full baked trace replays at 2× speed.

- [ ] **Step 3: Spot-check console**

DevTools console should be free of errors and warnings on every screen.

- [ ] **Step 4: Reduced motion**

In OS settings, enable "Reduce motion." Reload `/explorer`. Trace events appear without slide/fade. Splash pins appear without animation. Lighthouse should still score a11y ≥ 90.

- [ ] **Step 5: Commit any verification fixes if needed**

```bash
git add -A
git commit -m "chore(frontend): post-verification fixes"
```

---

## Self-Review Checklist

I ran the spec self-review against this plan:

**1. Spec coverage:** Every spec section maps to one or more tasks: tokens (T1) · component CSS (T2) · fonts (T3) · shell (T4-5) · trust badge (T6) · citation pill (T7) · drawer (T8-10) · splash (T11) · SSE types (T12) · demo data (T9, T13, T21) · event-stream hook (T14) · trace renderers (T15-17) · explorer assembly (T18-19) · maps (T20, T22-23) · atlas chrome (T24) · drilldown (T25) · atlas page (T26) · methodology (T27) · cleanup (T28) · polish (T29-30) · handoff doc (T31) · verification (T32). No spec gaps.

**2. Placeholder scan:** Tasks that say "Paste from data.js" specify the exact source field shape and require concrete TS-typed output — engineer cannot leave a TODO. Two tasks (T15, T22) say "Port lines X-Y" and reference the spec for the expected component signatures; this is acceptable because the source code IS the spec at that level of fidelity.

**3. Type consistency:** `RecommendedFacility` defined in T6's `lib/types.ts` is used identically in T9 (FACILITIES), T10 (FacilityDrawer), T18 (RecommendationCard), T19 (Explorer), T26 (Atlas drilldown). `StreamEvent` discriminated union in T12 is consumed identically by T14 (useEventStream), T15 (renderers), T17 (TraceEvent router), T19 (Explorer). `useDrawer` signature defined in T8 is called identically in T10, T18, T25.

**4. Round-trip wire format:** Every new SSE event type in T12 has a baked equivalent in T13's DEMO_TRACE and a renderer in T15-17 — partner can drop in a backend emitter that produces the JSON shape and zero frontend changes are needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-sanjeevani-design-wireup.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 32-task port where each task is self-contained.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
