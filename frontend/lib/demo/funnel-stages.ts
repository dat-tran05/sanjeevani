/**
 * Retrieval funnel stages — the visual that turns "10k facilities" into the
 * final ranked 3. Ported from the Claude Design prototype's `funnel`
 * (sanjeevani-chat.jsx). Each stage lights up as a downstream event arrives.
 */
import type { StreamEvent } from "@/lib/sse";

export type StageTone = "neutral" | "muted" | "accent" | "green";

export interface FunnelStage {
  id: string;
  label: string;
  count: string;
  tone: StageTone;
  /**
   * Predicate against the running event list — when this returns true at
   * least once, the stage transitions from dim to lit. Receives every tagged
   * event seen so far (live or demo) to decide.
   */
  trigger: (events: ReadonlyArray<StreamEvent>) => boolean;
}

const hasToolCall = (events: ReadonlyArray<StreamEvent>, n: number) =>
  events.filter((e) => e.type === "tool_call").length >= n;

const hasStepStart = (events: ReadonlyArray<StreamEvent>, stepId: string) =>
  events.some(
    (e) => e.type === "agent_step_start" && e.data.step_id === stepId,
  );

const hasStepEnd = (events: ReadonlyArray<StreamEvent>, stepId: string) =>
  events.some(
    (e) => e.type === "agent_step_end" && e.data.step_id === stepId,
  );

const hasType = (
  events: ReadonlyArray<StreamEvent>,
  type: StreamEvent["type"],
) => events.some((e) => e.type === type);

export const FUNNEL_STAGES: ReadonlyArray<FunnelStage> = [
  {
    id: "universe",
    label: "Total facilities",
    count: "10,053",
    tone: "muted",
    // Always lit — the universe is known before the agent runs.
    trigger: () => true,
  },
  {
    id: "state_filter",
    label: "State + geo prefilter",
    count: "429",
    tone: "neutral",
    trigger: (e) => hasToolCall(e, 1) || hasStepEnd(e, "intent"),
  },
  {
    id: "type_filter",
    label: "Type + rural filter",
    count: "180",
    tone: "neutral",
    trigger: (e) => hasToolCall(e, 1) || hasStepEnd(e, "retriever"),
  },
  {
    id: "rrf",
    label: "BM25 + dense → RRF",
    count: "50",
    tone: "accent",
    trigger: (e) => hasToolCall(e, 2) || hasStepStart(e, "rerank"),
  },
  {
    id: "rerank",
    label: "LLM rerank",
    count: "10",
    tone: "accent",
    trigger: (e) => hasStepEnd(e, "rerank") || hasType(e, "model_proposal"),
  },
  {
    id: "trust",
    label: "Trust verified",
    count: "5",
    tone: "green",
    trigger: (e) => hasType(e, "consensus_resolved"),
  },
  {
    id: "consensus",
    label: "MoA consensus",
    count: "3",
    tone: "green",
    trigger: (e) =>
      hasType(e, "recommendations_ready") || hasType(e, "validator_pass"),
  },
];
