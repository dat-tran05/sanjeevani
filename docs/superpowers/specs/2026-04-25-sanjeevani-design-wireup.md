# Sanjeevani — Wire the Claude Design Into the Codebase

## Context

We have a `sanjeevani` repo (FastAPI + LangGraph backend + Next.js 16 / React 19 frontend) for a Hack-Nation × World Bank 2026 healthcare-discovery demo. The current frontend is a single bare `Chat` component. The user's design partner produced a polished mockup in Claude Designs ("Sanjeevani.html" + ~1,400 lines of CSS + 4 JSX files + mock GeoJSON) covering four screens: **Splash · Explorer · Atlas (Crisis Map) · Methodology**, plus the signature `JuryPanel`, `TrustBadge`, `CitationPill`, `FacilityDrawer`, and `WhyNotThese` components.

This spec replaces the existing frontend with a faithful port of that design, wires it to the existing backend's SSE event stream where events match, and stubs everything else from a typed demo-data module. The user's partner is concurrently extending the backend; the priority here is **(a) airtight TypeScript types so the partner's wire format slots in cleanly later, (b) production-grade frontend polish that wins the demo's UX & Transparency rubric (see `docs/OVERVIEW.md` §7 + `DESIGN_HANDOFF.md`).**

User decisions captured:

1. **Hybrid live + baked fallback.** Frontend renders live SSE events as they arrive; missing events (`model_proposal`, `consensus_resolved`, `validator_pass`, `recommendations_ready`) fall back to baked demo data.
2. **App Router routes** — `/`, `/explorer`, `/atlas`, `/methodology`. `FacilityDrawer` and `TopBar` live in `app/layout.tsx`.
3. **Hybrid CSS** — design tokens go into Tailwind 4 `@theme`; component-scoped CSS preserved verbatim from the design's `styles.css` (animations, gradients, hand-tuned details would be lossy as utilities).
4. **Stub everything we don't have.** No new REST endpoints; atlas/recommendations/facilities all read from typed `lib/demo/*.ts` modules.

---

## Architecture

### Routing

```
frontend/app/
├── layout.tsx              TopBar + <FacilityDrawer/> mount + body[data-mode|palette|display|topo]
├── globals.css             @theme tokens + @import for component CSS modules
├── page.tsx                Splash (server component → <SplashClient/>)
├── explorer/page.tsx       Query + recommendations + why-not-these + trace stream
├── atlas/page.tsx          MapLibre + drilldown (dynamic import, ssr:false)
└── methodology/page.tsx    Static prose + pipeline + judges
```

`FacilityDrawer` opens via URL params (`?facility=F-MZN-0214&citation=c1`) so it deep-links and works from any tab.

### Component tree

```
components/
├── shell/         BrandMark, LeafGlyph, TopoBg, TopBar, StatePill
├── splash/        SplashHero, SplashVisual (animated India SVG, 240 pins, Bihar bullseye)
├── explorer/      QueryBlock, AnswerProse, RecommendationCard, ReasonLine, WhyNotThese, ResultEyebrow
├── trace/         TraceStream, TraceEvent (router), ThinkingNode, AgentStepNode, ToolCallNode,
│                  ProposalsNode, JuryPanel, ValidatorNode, AnswerReadyNode
├── trust/         TrustBadge, TrustDimRow
├── citation/      CitationPill, CitationTooltip
├── atlas/         AtlasMap, CapabilitySegmented, LayerToggles, AtlasSearch, AtlasLegend,
│                  AtlasBreadcrumb, AtlasTooltip, DistrictDrillDown
├── drawer/        FacilityDrawer, RawRowCollapse, CapabilityVerdictsGrid
└── ui/            Existing shadcn primitives (button/card/input) — kept as escape hatch
```

### Lib & data

```
lib/
├── sse.ts                  Discriminated-union StreamEvent + streamQuery() (extends current file)
├── types.ts                Domain types (FacilityTrust, RecommendedFacility, etc.)
├── utils.ts                Existing cn() helper
├── hooks/
│   ├── use-event-stream.ts Live + baked-fallback merge
│   └── use-drawer.ts        URL-param drawer state
├── demo/
│   ├── trace.ts             Baked typed StreamEvent[] sequence
│   ├── facilities.ts        F-MZN-0214, F-DBH-0109, F-PAT-0331 + descriptions/citations
│   ├── exclusions.ts        Why-not-these list
│   ├── hero-queries.ts      Suggestion chips
│   ├── states-geo.ts        Hand-traced state polygons (port india-geo.js)
│   ├── districts-geo.ts     50 district points with gap scores
│   ├── capability-bias.ts   Per-state gap multipliers per capability
│   └── topo-svg.ts          Topographic background SVG
└── maps/
    ├── geo-utils.ts        centroidLngLat, bboxLngLat, gapColor interpolators
    └── maplibre-setup.ts   Source + layer factories
```

### Styles

```
app/globals.css             @theme block (Tailwind 4 tokens) +
                            :root / [data-palette=*] / [data-mode=light] selectors +
                            @import "../styles/*.css"
styles/
├── shell.css   splash.css   explorer.css   trace.css
├── trust.css   citation.css   atlas.css   drawer.css
└── about.css
```

### New deps

- `maplibre-gl` (~250KB, runtime; loaded only on `/atlas` via `dynamic`)
- Fonts via `next/font/google`: Fraunces, Inter, JetBrains Mono — bound to `--display`, `--sans`, `--mono`

---

## SSE & Domain Type Contract

This is the partner-handoff artifact. File: `frontend/lib/sse.ts` (extends current). A copy lives in `docs/sse-event-contract.md` for backend reference.

```ts
export type StreamEvent =
  | { type: "thinking_delta";        data: { text: string } }
  | { type: "agent_step_start";      data: { step_id: string; name: string; label: string } }
  | { type: "agent_step_end";        data: { step_id: string; name: string; summary?: string; duration_ms?: number } }
  | { type: "tool_call";             data: { tool: string; input?: Record<string,unknown>; output_summary?: string; duration_ms?: number } }
  | { type: "model_proposal";        data: { proposer_id: "A" | "B"; vendor: string; title: string; text: string } }
  | { type: "consensus_resolved";    data: ConsensusResolvedData }
  | { type: "validator_pass";        data: { title: string; body: string; passed: boolean } }
  | { type: "text_delta";            data: { text: string } }
  | { type: "citation";              data: { citation_id: string; facility_id: string; column: string; char_start: number; char_end: number; excerpt: string } }
  | { type: "recommendations_ready"; data: { facilities: RecommendedFacility[]; excluded: ExcludedFacility[]; pipeline_ms: number; candidates_considered: number } }
  | { type: "error";                 data: { message: string } };

interface ConsensusResolvedData {
  claim: string;
  title?: string;
  verdict: "supported" | "partial" | "unsupported";
  agreement: 0 | 1 | 2 | 3;
  dissent: boolean;
  judges: Array<{
    name: string;       // "Claude Sonnet 4.6"
    vendor: string;     // "Anthropic · Bedrock"
    verdict: "supported" | "partial" | "unsupported";
    confidence: number; // 0-1
    excerpt: string;
    dissent_note?: string;
  }>;
  tiebreaker?: { model: string; verdict: "supported"|"partial"|"unsupported"; reasoning: string };
}
```

Domain types in `lib/types.ts`:

```ts
export interface FacilityTrust {
  existence: 0|1|2|3; coherence: 0|1|2|3; recency: 0|1|2|3; specificity: 0|1|2|3; score: number;
}
export interface FacilityCitation { id: string; column: string; char_start: number; char_end: number; text: string; }
export interface CapabilityVerdict { name: string; agree: "3/3"|"2/3"|"1/3"|"0/3"; verdict: "supported"|"partial"|"unsupported"; }
export interface RecommendedFacility {
  id: string; name: string; type: string; state: string; district: string;
  latitude: number; longitude: number; distance_km: number;
  trust: FacilityTrust; capabilities: CapabilityVerdict[]; citations: FacilityCitation[]; description: string;
}
export interface ExcludedFacility { name: string; district: string; type: string; reason: string; verdict: "partial"|"unsupported"; }
```

Wire-compatible with the current backend (`backend/app/streaming/sse.py`): existing emitters keep working. New events are additive. Notable additions partner needs to handle:

- `step_id` on `agent_step_start` / `agent_step_end` — pairs them so spinner-to-checkmark transitions are unambiguous when multiple steps are inflight.
- `citation_id` on `citation` — matches the citation pill clicked to open the drawer.
- `recommendations_ready` — terminal structured payload that supplies the `RecommendationCard`s and `WhyNotThese` list.

### Demo-mode mechanic (`lib/hooks/use-event-stream.ts`)

```
1. POST /query, parse SSE frames into StreamEvent[]
2. Yield each event live as it arrives
3. After text_delta tail OR 8s timeout:
     if no model_proposal seen   → yield demo MoA sequence
     if no consensus_resolved seen → yield demo jury sequence (Bihar appendectomy)
     if no validator_pass seen   → yield demo validator stamp
     if no recommendations_ready → yield demo recommendations
4. Demo-injected events tagged __source: "demo" → small gold "demo data" pill in dev only
5. ?demo=1 → skip live fetch entirely, replay full baked sequence
   ?demo=1&speed=2 → speed up replay
```

When backend ships a missing event type, the corresponding fallback simply stops triggering — zero frontend changes required.

### Atlas data (no REST, all stub)

Loaded synchronously from `lib/demo/states-geo.ts`, `lib/demo/districts-geo.ts`, `lib/demo/capability-bias.ts`. Swappable to a `fetch('/api/...')` later by changing one import.

---

## Implementation Order

### Round 1 — Foundation
1. **Tokens + Tailwind 4 `@theme`** — port design's `:root` block; preserve `[data-palette]`, `[data-mode]`, `[data-display]`, `[data-topo]` selectors as plain CSS in `globals.css`.
2. **Fonts** — `next/font/google` for Fraunces, Inter, JetBrains Mono.
3. **Component CSS modules** — split design's `styles.css` into `styles/{shell,splash,explorer,trace,trust,citation,atlas,drawer,about}.css`; `@import` from `globals.css`.
4. **Shell components** — `LeafGlyph`, `BrandMark`, `TopoBg`, `TopBar` (tabs as `<Link>`), `StatePill`.
5. **`app/layout.tsx`** — wraps children with `<TopBar/>` + global `<FacilityDrawer/>`; sets body data attrs.

### Round 2 — Shared primitives
6. **`TrustBadge`** — 4 vertical bars, sizes sm/md/lg.
7. **`CitationPill` + `CitationTooltip`** — hover tooltip with `<mark>`-highlighted excerpt.
8. **`use-drawer` hook** — URL params for facility + citation.
9. **`FacilityDrawer`** — global mount; trust badge, capability verdicts, description with citations highlighted, raw row collapse.

### Round 3 — Splash (`app/page.tsx`)
10. **`SplashHero`** — display-serif headline, 4-stat grid, CTAs as `<Link>`s.
11. **`SplashVisual`** — animated SVG India outline, 240 pins, Bihar bullseye pulse.

### Round 4 — Type contract + streaming
12. **Extend `lib/sse.ts`** — discriminated union + `streamQuery()` keeps current behavior.
13. **`lib/types.ts`** — domain types.
14. **`lib/demo/*.ts`** — port `data.js` mocks to typed TS modules.
15. **`lib/hooks/use-event-stream.ts`** — live + baked-fallback merge, `?demo=1` support.

### Round 5 — Explorer (`app/explorer/page.tsx`)
16. **`QueryBlock`** — input, replay, suggestion chips.
17. **All trace event renderers** — `ThinkingNode`, `AgentStepNode`, `ToolCallNode`, `ProposalsNode`, `JuryPanel`, `ValidatorNode`, `AnswerReadyNode`.
18. **`TraceStream`** — auto-scroll, live dot, event count.
19. **`AnswerProse`, `RecommendationCard`, `ReasonLine`, `WhyNotThese`** — main column.

### Round 6 — Atlas (`app/atlas/page.tsx`)
20. **`maplibre-gl` install + `lib/maps/{geo-utils,maplibre-setup}.ts`**.
21. **`AtlasMap`** — dynamic import, layer setup, interactions (hover/click/fly-to).
22. **Atlas chrome** — `CapabilitySegmented`, `LayerToggles`, `AtlasSearch`, `AtlasLegend`, `AtlasBreadcrumb`, `AtlasTooltip`.
23. **`DistrictDrillDown`** — right-column panel.

### Round 7 — Methodology (`app/methodology/page.tsx`)
24. Static prose + pipeline cards + judge cards.

### Round 8 — Polish
25. Reduced-motion verify, demo-source dev pill, accessibility pass (focus rings, `aria-live` on trace, alt text), keyboard shortcuts (`/`, `m`, `?`) if time.

### Replace / delete
- `frontend/app/page.tsx` — replaced by Splash.
- `frontend/components/chat/Chat.tsx` — replaced by Explorer composition (delete after migration).
- `frontend/app/globals.css` — replaced by tokens + imports.

### Out of scope
- Real REST endpoints (`/api/states`, `/api/districts`, `/api/state-stats`) — backend partner's lane.
- `deck.gl` for 10k pins — defer until real facility data.
- Tweaks/palette switcher panel — internal-only design tool, dropped.
- Devanagari subscript, snapshot export, sound design — DESIGN_HANDOFF stretch items.

---

## Critical Files (reference)

**Existing — read before modifying:**
- `frontend/AGENTS.md` / `frontend/CLAUDE.md` — Next.js 16 has breaking changes from training data; read `node_modules/next/dist/docs/` before writing code.
- `frontend/app/page.tsx`, `frontend/components/chat/Chat.tsx`, `frontend/lib/sse.ts` — current state; will be replaced/extended.
- `backend/app/streaming/sse.py` — existing event helpers; types must stay wire-compatible.
- `docs/OVERVIEW.md` §7 — UX spec; SSE event taxonomy authoritative.

**Design source (in `C:\Users\datct\AppData\Local\Temp\sanjeevani-design\sanjeevani\project\`):**
- `Sanjeevani.html` — entry point.
- `styles.css` — token + component CSS.
- `components-base.jsx` — `LeafGlyph`, `BrandMark`, `TopBar`, `TrustBadge`, `CitationPill`, `Splash`, `SplashVisual`.
- `components-explorer.jsx` — Explorer + all trace event renderers + `JuryPanel` + `RecommendationCard` + `WhyNotThese`.
- `components-atlas.jsx` — `Atlas`, `DistrictDrillDown`, `FacilityDrawer`, `Methodology`.
- `data.js` — mock `FACILITIES`, `TRACE`, `EXCLUSIONS`, `HERO_QUERIES`, `CAPABILITIES`, `CAP_BIAS`.
- `india-geo.js` — `STATES_GEO`, `DISTRICTS_GEO`, `centroidLngLat`, `bboxLngLat`, `STATE_ID_OF`.
- `india-svg.js` — topographic background SVG.

---

## Verification

End-to-end checks once each round lands:

1. **Round 1:** `npm run dev`, hit `/`. Top bar renders with brand + tabs + state pill. Body has `data-mode="dark" data-palette="warm"`. Page background uses warm-civic ink.
2. **Round 2:** Manually mount `<TrustBadge trust={...}/>` and `<CitationPill citation={...}/>` in a temporary route; verify hover tooltip + 4-bar render. Open drawer via `?facility=F-MZN-0214` URL param.
3. **Round 3:** `/` shows splash with animated pins + pulsing Bihar bullseye + working CTA links.
4. **Round 4:** SSE types compile; `tsc --noEmit` clean. With backend down, `useEventStream("test")` yields baked sequence after timeout. With backend up, live events render and missing event types are filled by demo fallback.
5. **Round 5:** `/explorer` — query block + replay button + suggestion chips work. Trace stream replays baked sequence at 1× speed. Recommendation cards render with trust badge + citations. Hover citation pill → tooltip with highlighted excerpt. Click citation → `FacilityDrawer` opens scrolled to spotlight. `WhyNotThese` toggles.
6. **Round 6:** `/atlas` — MapLibre loads, India centered. Capability segmented control recolors choropleth. Click state → fly-to + drilldown updates. Click district pin → drilldown updates. Search filters states + districts. Layer toggles hide/show.
7. **Round 7:** `/methodology` renders cleanly, no console errors.
8. **Round 8:** `prefers-reduced-motion: reduce` disables animations. Lighthouse a11y >90.
9. **Type contract:** `lib/sse.ts` discriminated union exhaustive; `tsc --noEmit` clean. Markdown copy in `docs/sse-event-contract.md` matches.
10. **Cross-tab:** open drawer via `?facility=…` from `/atlas`, navigate to `/explorer` — drawer remains, URL preserved.

UI verification per the system prompt: spin up dev server, click through the golden path (splash → explorer → atlas → drawer → methodology), monitor for regressions and console errors before claiming complete.

---

## Handoff Artifacts

After implementation:
1. `docs/sse-event-contract.md` — markdown of the discriminated union + JSON schema examples for the partner's backend changes.
2. Code-level docstrings on the missing-event branches in `use-event-stream.ts` pointing to which backend node should emit each event (mapped to `docs/OVERVIEW.md` §5.3 stages).
3. A short "Backend integration" section in `frontend/README.md` listing env vars, endpoint expectations, and the demo-mode toggle.
