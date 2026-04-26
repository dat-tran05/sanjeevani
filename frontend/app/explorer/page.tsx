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
import { setLiveFacilities } from "@/lib/live-facilities-store";
import { HERO_QUERIES } from "@/lib/demo/hero-queries";
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

  const initial = queries[0];
  // `activeQueryId` is only used to look up the demo answerLine for the chip
  // the user explicitly picked. Free-form queries leave it on the last chip
  // (or empty) and the answerLine fallback for them is handled below.
  const [activeQueryId, setActiveQueryId] = useState(initial?.id ?? "");
  const [pendingText, setPendingText] = useState(initial?.text ?? "");

  const { events, run } = useEventStream({ forceDemo, speed });
  const { openDrawer } = useDrawer();

  const activeQuery =
    queries.find((q) => q.id === activeQueryId) ?? queries[0];

  // Fire on mount + whenever pendingText changes (chip click or Enter key).
  useEffect(() => {
    if (pendingText) void run(pendingText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingText, forceDemo, speed]);

  // Prefer live recommendations if the backend emitted them. In `?demo=1`
  // mode the demo fallback inside useEventStream synthesizes
  // recommendations_ready, so we fall back to bundled FACILITIES only as a
  // final safety net (when the demo trace is also missing).
  const recsEvent = events.find((te) => te.ev.type === "recommendations_ready");
  const recsData =
    recsEvent && recsEvent.ev.type === "recommendations_ready" ? recsEvent.ev.data : null;
  const liveFacilities: RecommendedFacility[] = recsData?.facilities ?? [];
  const liveExclusions = recsData?.excluded;

  // Concatenate streamed text_delta chunks — backend's emit node sends the
  // aggregator's synthesized prose paragraph in word-sized chunks.
  const liveProse = events
    .filter((te) => te.ev.type === "text_delta")
    .map((te) => (te.ev.type === "text_delta" ? te.ev.data.text : ""))
    .join("")
    .trim();
  // First paint shows nothing for prose so demo content doesn't flash.
  // After stream completes, fall back to the chip answerLine if the live
  // text was empty (off-script queries).
  const recsArrived = !!recsData;
  const synthesizedProse = liveProse || (recsArrived ? activeQuery?.answerLine || "" : "");

  // While the live stream is in progress, show no cards yet (avoid the
  // confusing "demo cards then live cards" flash). In demo mode the demo
  // fallback emits recommendations_ready immediately so cards appear.
  const showCards = liveFacilities.length > 0;
  const showCardsPlaceholder = !showCards;

  // Publish the live cards to the module-level store so the FacilityDrawer
  // can render their description + citations + capabilities (the data the
  // /facilities/{id} endpoint doesn't carry).
  useEffect(() => {
    if (liveFacilities.length > 0) setLiveFacilities(liveFacilities);
  }, [liveFacilities]);

  const onCitationClick = (facilityId: string, citation: FacilityCitation) => {
    openDrawer(facilityId, citation.id);
  };

  return (
    <div className="explorer">
      <TopoBg />
      <div className="explorer-main">
        <QueryBlock
          queries={queries}
          pendingText={pendingText}
          onSubmit={(text) => setPendingText(text)}
          onPickChip={(id) => setActiveQueryId(id)}
        />
        <div className="result-section">
          <ResultEyebrow
            label="Synthesized answer"
            count={`${liveFacilities.length} verified`}
          />
          <AnswerProse>{synthesizedProse}</AnswerProse>

          <ResultEyebrow label="Ranked recommendations" />
          {showCards ? (
            liveFacilities.map((f, i) => (
              <RecommendationCard
                key={f.id}
                facility={f}
                rank={i + 1}
                onCitationClick={onCitationClick}
                onOpen={(id) => openDrawer(id)}
              />
            ))
          ) : null}
          {showCardsPlaceholder && (
            <div
              style={{
                padding: "32px 20px",
                border: "1px dashed var(--line)",
                borderRadius: 12,
                color: "var(--fg-mute)",
                fontSize: 13,
                textAlign: "center",
                fontFamily: "var(--mono)",
                letterSpacing: "0.04em",
              }}
            >
              Pipeline running · ranked cards appear when the validator approves the citations
            </div>
          )}

          {(showCards || liveExclusions) && (
            <WhyNotThese exclusions={liveExclusions} />
          )}

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
