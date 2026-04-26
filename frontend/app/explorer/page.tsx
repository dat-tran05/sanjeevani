"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
import type { FacilityCitation, HeroQuery, RecommendedFacility } from "@/lib/types";

function ExplorerInner() {
  const searchParams = useSearchParams();
  const forceDemo = searchParams.get("demo") === "1";
  const urlQuery = searchParams.get("q");
  const speedParam = Number(searchParams.get("speed") ?? "1");
  const speed = Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 1;

  // Merged hero query list — when the user lands here from /atlas's
  // "Ask about this district" CTA, prepend that query so it appears as
  // a chip and is selected on first paint.
  const queries = useMemo<HeroQuery[]>(() => {
    if (!urlQuery) return HERO_QUERIES;
    const fromAtlas: HeroQuery = {
      id: "from-atlas",
      label: "from atlas",
      text: urlQuery,
      answerLine: "Pulled from the Crisis Map drill-down — re-running through the same agent pipeline.",
    };
    return [fromAtlas, ...HERO_QUERIES];
  }, [urlQuery]);

  // First-paint pin: if there's a from-atlas entry, it leads. The component
  // is keyed on `?q=` by ExplorerKeyed below, so URL changes remount the
  // tree and re-run this initializer with fresh queries.
  const [activeQueryId, setActiveQueryId] = useState(queries[0]?.id ?? "");

  const { events, run } = useEventStream({ forceDemo, speed });
  const { openDrawer } = useDrawer();

  const activeQuery =
    queries.find((q) => q.id === activeQueryId) ?? queries[0];

  useEffect(() => {
    if (activeQuery) void run(activeQuery.text);
    // re-run only when active query id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueryId, forceDemo, speed]);

  // Prefer live recommendations if the backend emitted them; otherwise the
  // demo fallback (or baked HERO_FACILITY_IDS for first paint).
  const recsEvent = events.find((te) => te.ev.type === "recommendations_ready");
  const liveFacilities: RecommendedFacility[] =
    recsEvent && recsEvent.ev.type === "recommendations_ready"
      ? recsEvent.ev.data.facilities
      : HERO_FACILITY_IDS.map((id) => FACILITIES[id]).filter(
          (f): f is RecommendedFacility => Boolean(f)
        );

  const onCitationClick = (facilityId: string, citation: FacilityCitation) => {
    openDrawer(facilityId, citation.id);
  };

  const onReplay = () => {
    if (activeQuery) void run(activeQuery.text);
  };

  return (
    <div className="explorer">
      <TopoBg />
      <div className="explorer-main">
        <QueryBlock
          queries={queries}
          activeQueryId={activeQueryId}
          onQueryChange={setActiveQueryId}
          onReplay={onReplay}
        />
        <div className="result-section">
          <ResultEyebrow
            label="Synthesized answer"
            count={`${liveFacilities.length} verified`}
          />
          <AnswerProse>{activeQuery?.answerLine}</AnswerProse>

          <ResultEyebrow label="Ranked recommendations" />
          {liveFacilities.map((f, i) => (
            <RecommendationCard
              key={f.id}
              facility={f}
              rank={i + 1}
              onCitationClick={onCitationClick}
              onOpen={(id) => openDrawer(id)}
            />
          ))}

          {liveFacilities[0] && (
            <div className="top-pick" role="note">
              <span className="top-pick-glyph" aria-hidden>
                ★
              </span>
              <div className="top-pick-body">
                <span className="top-pick-eyebrow">Top pick</span>
                <p>
                  <strong>{liveFacilities[0].name}</strong> — three of three
                  judges agree the description cites a 24-hour emergency
                  theatre with on-call general surgery and explicit
                  laparoscopic appendectomy. Strongest documented capability
                  among the rural Bihar candidates.
                </p>
              </div>
            </div>
          )}

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
            All claims sourced from delta.silver.facilities · jury verdicts from
            gold.capability_verdicts
          </div>
        </div>
      </div>
      <TraceStream events={events} totalExpected={16} />
    </div>
  );
}

function ExplorerKeyed() {
  const searchParams = useSearchParams();
  // Keying on `?q=` so a navigation from /atlas's CTA reinitializes
  // ExplorerInner's activeQueryId without a setState-in-effect.
  return <ExplorerInner key={searchParams.get("q") ?? ""} />;
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={null}>
      <ExplorerKeyed />
    </Suspense>
  );
}
