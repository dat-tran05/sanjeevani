# Map Rebuild — Session Context Dump

**Date:** 2026-04-26
**Worktree:** `.claude/worktrees/feat-map-rebuild`
**Branch:** `worktree-feat-map-rebuild` (based on `feat/design-wireup`)
**Plan file:** `C:\Users\datct\.claude\plans\explore-and-understand-my-starry-duckling.md`

---

## 1. Project context

- **Sanjeevani** — Hack-Nation × World Bank 2026 Challenge 03 (Databricks). Agentic
  healthcare-discovery system over a 10,053-row Indian medical facility CSV.
- Authoritative design: `docs/OVERVIEW.md`. Build plan: `docs/superpowers/specs/2026-04-25-sanjeevani-build-plan-design.md`. Frontend wireup spec: `docs/superpowers/specs/2026-04-25-sanjeevani-design-wireup.md`.
- Stack: Next.js 16.2 (App Router, `cacheComponents: true`, React 19), MapLibre GL JS, FastAPI + LangGraph backend (not wired yet), Databricks offline pipelines (in progress).
- `frontend/AGENTS.md` warning: Next 16 has breaking changes from training data — read `node_modules/next/dist/docs/` before writing Next-specific code.

## 2. The ask

1. Explore + understand the codebase ("ultrathink").
2. Redo the map implementation that was originally ported from a Claude Designs mockup.
3. Implement the map per OVERVIEW §7 (MapLibre + deck.gl + 10k pins + district-level choropleth + click-region drill-down).
4. Layer in functionality from CHALLENGE.md and build-plan as needed.
5. Do all this in a separate worktree.
6. Clarified mid-session: real basemap required, "right now nothing is showing", aim for "typical map app" look.

## 3. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Functional extension, keep current chrome | User picked it from the AskUserQuestion menu |
| Pin data | Real CSV at build time → trimmed JSON in `/public` | User picked it; backend isn't wired |
| Basemap | OpenFreeMap dark vector (`https://tiles.openfreemap.org/styles/dark`) | Free, no API key, MapLibre-native |
| Boundaries | Datameet/GADM via `geohacker/india` GitHub repo | Datameet's `States/` ships only shapefiles; geohacker has the GADM-derived GeoJSON |
| Worktree | `.claude/worktrees/feat-map-rebuild`, branch `worktree-feat-map-rebuild` | EnterWorktree branched from `main` first; manually `git reset --hard feat/design-wireup` to retarget |

## 4. What was implemented (5 steps, all done)

### Step 1 — basemap + remove void
- `AtlasMap.tsx` style swapped from inline `{ background-color: #070D10 }` to OpenFreeMap dark URL.
- `setupLayers` inserts our fills/lines **before** the basemap's first symbol layer (basemap city labels stay above choropleth); marker/label layers go on top.
- Fonts changed Open Sans Regular → **Noto Sans Regular** (the font OpenFreeMap ships).

### Step 2 — real Datameet boundaries
- Downloaded `india_state.geojson` (22 MB) + `india_district.geojson` (34 MB) from `geohacker/india`.
- Simplified with `npx mapshaper`:
  ```bash
  mapshaper india_state.geojson    -simplify 2%   keep-shapes -filter-fields NAME_1,ID_1   -o precision=0.01 india-states.geo.json
  mapshaper india_district.geojson -simplify 0.5% keep-shapes -filter-fields NAME_1,NAME_2 -o precision=0.01 india-districts.geo.json
  ```
- Output: `frontend/public/india-states.geo.json` (243 KB / 60 KB gz) + `india-districts.geo.json` (506 KB / 100 KB gz).
- New module-level `loadIndiaGeo()` async cache; new `enrichDistricts()` for the polygon FC; old districts-points logic renamed to `enrichDistrictPoints()`.
- State-fill opacity fades 0.45 → 0 between zoom 5–7; district-fill fades 0 → 0.5 between zoom 5–6 — automatic crossover so the dominant overlay always matches the zoom level.

### Step 3 — 10k facility pins via deck.gl
- New `frontend/scripts/build-facilities-json.cjs` parses `data/india_healthcare_facilities.csv` → `public/facilities.min.json` (1.5 MB / 350 KB gz).
- 10,000 rows kept, 0 dropped (all in India bbox).
- Deps added: `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox`. DevDep: `csv-parse`.
- `MapboxOverlay({ interleaved: true, layers: [ScatterplotLayer] })` mounted via `map.addControl`.
- Click → `openDrawerRef.current(facility.id)` → URL `?facility=Fxxxxx` → `<FacilityDrawer>` reads param.
- Pin colors by `type`: hospital gold, clinic green, dentist orange, doctor/pharmacy gray.

### Step 4 — Map ↔ chat link
- `DistrictDrillDown` adds a gold `<Link href="/explorer?q=Verified ${cap} facilities in ${district}">` CTA.
- `app/explorer/page.tsx` reads `?q=`, prepends a `from atlas` chip to `HERO_QUERIES`, runs through existing `useEventStream`.
- Page keyed on `?q=` (`<ExplorerInner key={searchParams.get("q") ?? ""}/>`) to avoid `set-state-in-effect` lint.
- `QueryBlock` refactored to take `queries: HeroQuery[]` prop instead of importing `HERO_QUERIES` directly.

### Step 5 — verify
- `npx tsc --noEmit` ✓
- `npm run lint` ✓
- `npm run build` ✓ (5 routes prerendered: `/`, `/atlas`, `/explorer`, `/methodology`, `/_not-found`)
- HTTP smoke: `/atlas`, `/explorer`, `/explorer?q=...`, `facilities.min.json`, both GeoJSON files — all 200.
- **Visual verification not done** — no browser-automation tools available this session. Open `http://localhost:3001/atlas` to confirm.

## 5. Files changed

**Modified:**
- `frontend/app/explorer/page.tsx`
- `frontend/components/atlas/AtlasMap.tsx`
- `frontend/components/atlas/DistrictDrillDown.tsx`
- `frontend/components/explorer/QueryBlock.tsx`
- `frontend/lib/maps/maplibre-setup.ts`
- `frontend/lib/types.ts` (added `MapFacility`)
- `frontend/styles/atlas.css` (added `.dd-cta`)
- `frontend/package.json` + `package-lock.json`

**Untracked / new:**
- `frontend/scripts/build-facilities-json.cjs`
- `frontend/public/facilities.min.json`
- `frontend/public/india-states.geo.json`
- `frontend/public/india-districts.geo.json`
- `docs/superpowers/notes/2026-04-26-map-rebuild-context.md` (this file)

## 6. Honest accuracy assessment

| Layer | Real from `/data`? | Driven by |
|---|---|---|
| 10,053 facility pins | ✅ Yes | `data/india_healthcare_facilities.csv` directly — position, name, state, city, pincode, type |
| State choropleth color | ❌ No | `computeStateGaps()` averaging the 50-row mockup `DISTRICTS_GEO` × `CAP_BIAS` multipliers |
| District choropleth color | ❌ No | `state baseline + pseudoVariation(districtName)` deterministic hash placeholder |
| Severe-gap dashed outlines | ❌ No | Filtered on synthetic state `gap` |
| 50 demo district markers | ❌ No | Hard-coded `lib/demo/districts-geo.ts` (Muzaffarpur, Patna, Bihar's Begusarai, etc.) |
| Hover tooltip stats | ❌ No | Same 50-row demo data |
| `DistrictDrillDown` numbers | ❌ No | Same 50-row demo data |

**Why** — OVERVIEW assumes per-region gap aggregates come from `gold.region_capability_stats` (Databricks pipeline), which doesn't write yet. Frontend was wired with mockup numbers so the design could be reviewed end-to-end. The redo left that contract intact and bolted real pins on top.

## 7. Outstanding questions

Two cheap upgrades to make the choropleth driven by real `/data` instead of the mockup:

1. **State-only density** — count CSV rows per `address_stateOrRegion`, use as gap proxy. ~30-line patch.
2. **District-level via point-in-polygon** — at build time, attach district to each pin via PIP against `india-districts.geo.json`, then aggregate. More granular, ~200 ms slower build.

Both are caveat-real: counts ≠ verified-for-capability. User hasn't picked yet.

## 8. Constraints / gotchas

- `curl` on Windows needs `--ssl-no-revoke` (CRYPT_E_NO_REVOCATION_CHECK).
- Bash sessions retain CWD between calls (despite the harness occasionally suggesting otherwise).
- `mapshaper` available via `npx --yes mapshaper@latest` — used for one-shot simplification.
- The design palette is dark warm-civic: gold `#BFA46A`, crimson `#C04A3F`, green `#34C58A`, ink `#0B1417`, defined in `globals.css`.
- The 3 hero facilities (`F-MZN-0214`, `F-DBH-0109`, `F-PAT-0331` in `lib/demo/facilities.ts`) are the only ones with rich `description / citations / capabilities / trust` fields. Pins for the other 9,997 facilities open the `FacilityDrawer` keyed to their CSV-derived id (`F00000`–`F09999`) but the drawer will lack rich content until backend wires real data.

## 9. Branch state at end of session

```
worktree-feat-map-rebuild  ← this map-rebuild work, ahead of feat/design-wireup
feat/design-wireup         ← design partner's wire-up; HEAD: fe3684a (retrieval funnel + trace cards)
                              moved 2 commits ahead of my worktree base during the session:
                                bb3b510 fix(stack): conform SSE event contract + race-safe useEventStream
                                fe3684a feat(frontend): retrieval funnel + design-spec trace cards
                              → likely conflicts on app/explorer/page.tsx + lib/types.ts when merging
main                        ← clean fast-forward from feat/design-wireup
```

## 10. Tasks (final state)

All 11 tasks completed. Visual verification (Task 11's last bullet) requires opening
`http://localhost:3001/atlas` in a browser — that's the user's call.
