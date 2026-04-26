/**
 * Sanjeevani — SSE backend ↔ frontend adapter.
 *
 * Translates the live backend wire format (the 14-event taxonomy in
 * `backend/app/streaming/sse.py`) into the frontend's `StreamEvent`
 * discriminated union (defined in `lib/sse.ts`).
 *
 * Why an adapter: the backend emits separate `jury_verdict` /
 * `tiebreaker_resolved` / `ranked_card` / `citation` / `exclusion` /
 * `stream_complete` events; the frontend renders one `consensus_resolved`
 * panel per claim and one terminal `recommendations_ready` payload. The
 * adapter buffers + reshapes accordingly. The demo fallback path
 * (`useEventStream` in dev mode) is unaffected — it still synthesizes
 * directly into the frontend shape.
 */
import type {
  ConsensusResolvedData,
  StreamEvent,
} from "@/lib/sse";
import type {
  CapabilityVerdict,
  ExcludedFacility,
  FacilityCitation,
  FacilityTrust,
  RecommendedFacility,
  Verdict,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Raw backend wire shapes (mirrors `backend/app/streaming/sse.py` constructors)
// ---------------------------------------------------------------------------

interface RawEvent {
  type: string;
  data: Record<string, unknown>;
}

interface RawThinkingDelta {
  step_id?: string;
  text: string;
}
interface RawAgentStepStart {
  name: string;
  label?: string;
  model?: string;
}
interface RawAgentStepEnd {
  name: string;
  label?: string;
  latency_ms?: number;
  meta?: Record<string, unknown>;
}
interface RawToolCall {
  name: string;
  input?: unknown;
  output_summary?: string;
  runtime_ms?: number;
  meta?: Record<string, unknown>;
}
interface RawModelProposal {
  slot: "A" | "B";
  model: string;
  vendor: string;
  content: string;
}
interface RawJudge {
  model: string;
  vendor: string;
  verdict: Verdict;
  confidence: number;
  quote: string;
}
interface RawJuryVerdict {
  claim_id: string;
  claim_text: string;
  judges: RawJudge[];
  agreement: { agree: number; dissent: number };
  final_verdict: Verdict;
  facility_id?: string;
  facility_name?: string;
}
interface RawTiebreaker {
  claim_id: string;
  model: string;
  rationale: string;
  final_verdict: Verdict;
}
interface RawValidatorCheck {
  model: string;
  status: "approved" | "flagged";
  message?: string;
  broken_offsets?: unknown[];
}
interface RawRankedCard {
  rank: number;
  facility_id: string;
  name: string;
  location: string;
  distance_km: number | null;
  type: string;
  trust_score: number;
  prose: string;
  citation_ids: string[];
  primary_claim_id: string;
  meta?: Record<string, unknown>;
}
interface RawCitation {
  citation_id: string;
  facility_id: string;
  column: string;
  char_start: number;
  char_end: number;
  excerpt: string;
}
interface RawExclusion {
  facility_id: string;
  name: string;
  location: string;
  type: string;
  reason: string;
  verdict: string;
}
interface RawStreamComplete {
  recommendation_count: number;
  exclusion_count: number;
  total_latency_ms: number;
}
interface RawError {
  message: string;
  stage?: string;
}

// ---------------------------------------------------------------------------
// Display normalization
// ---------------------------------------------------------------------------

const VENDOR_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic · Bedrock",
  meta: "Meta · Databricks",
  databricks: "Databricks · DBRX",
};

function modelDisplayName(model: string): string {
  // Map raw model IDs → short display names matching the mockup.
  if (/sonnet/i.test(model)) return "Claude Sonnet 4.6";
  if (/haiku/i.test(model)) return "Claude Haiku 4.5";
  if (/llama-3-3-70b|llama 3\.3 70b|llama-3.3-70b/i.test(model)) return "Llama 3.3 70B";
  if (/qwen3-next-80b|qwen 3 80b|qwen3.*80b/i.test(model)) return "Qwen 3 80B";
  if (/llama/i.test(model)) return "Llama 3.3 70B";
  if (/qwen/i.test(model)) return "Qwen 3 80B";
  return model;
}

function vendorDisplay(vendor: string, model?: string): string {
  const v = (vendor || "").toLowerCase();
  if (VENDOR_DISPLAY[v]) {
    // Prepend specific model on the proposers card line, e.g. "Anthropic · Sonnet 4.6"
    if (model) return `${VENDOR_DISPLAY[v].split(" · ")[0]} · ${modelDisplayName(model)}`;
    return VENDOR_DISPLAY[v];
  }
  return vendor || "unknown";
}

// ---------------------------------------------------------------------------
// Proposer JSON summarizer
// ---------------------------------------------------------------------------

/**
 * Backend MoA proposers emit raw model output (often a multi-KB JSON dump
 * with rationale + flags). The mockup expects a single short paragraph.
 * Try to parse and synthesize a 1-2 sentence summary; fall back to a
 * truncated raw string.
 */
function summarizeProposerContent(raw: string): string {
  let body = raw.trim();
  // Strip ```json ... ``` fences if present
  if (body.startsWith("```")) {
    const fenced = body.split("```");
    body = fenced[1] ?? body;
    if (body.startsWith("json")) body = body.slice(4);
    body = body.trim();
  }
  try {
    const parsed = JSON.parse(body) as {
      top?: Array<{ rank?: number; facility_id?: string; rationale?: string; name?: string }>;
    };
    const top = parsed.top ?? [];
    if (top.length === 0) throw new Error("no top");
    const rank1 = top[0];
    const names = top
      .slice(0, 3)
      .map((t, i) => {
        const label = t.name || (t.facility_id ? t.facility_id.slice(0, 8) : `#${i + 1}`);
        return `${label} (rank ${t.rank ?? i + 1})`;
      })
      .join(", ");
    const rationale = (rank1?.rationale || "").trim();
    const tail = rationale.length > 0
      ? ` — ${rationale.slice(0, 200)}${rationale.length > 200 ? "…" : ""}`
      : "";
    return `Recommends ${names}.${tail}`;
  } catch {
    // Fall back: first ~280 chars of raw
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > 280 ? flat.slice(0, 280) + "…" : flat;
  }
}

// ---------------------------------------------------------------------------
// Jury verdict transform
// ---------------------------------------------------------------------------

function transformJury(raw: RawJuryVerdict): ConsensusResolvedData {
  const consensus = raw.final_verdict;
  const agreement = (raw.agreement?.agree ?? 0) as 0 | 1 | 2 | 3;
  const dissent = (raw.agreement?.dissent ?? 0) > 0;
  const facilityLead = raw.facility_name ? `${raw.facility_name} · ` : "";
  return {
    claim: `claim_id: ${raw.claim_id}`,
    title: `${facilityLead}${raw.claim_text}`,
    verdict: consensus,
    agreement,
    dissent,
    judges: raw.judges.map((j) => ({
      name: modelDisplayName(j.model),
      vendor: vendorDisplay(j.vendor),
      verdict: j.verdict,
      confidence: j.confidence,
      excerpt: j.quote,
    })),
  };
}

// ---------------------------------------------------------------------------
// Capability + citation hydration helpers
// ---------------------------------------------------------------------------

interface FacilityDetailResponse {
  id: string;
  name: string;
  state?: string;
  city?: string;
  lat?: number | null;
  lon?: number | null;
  description?: string;
  type?: string;
  trust_badge?: {
    existence: number;
    coherence: number;
    recency: number;
    specificity: number;
  } | null;
}

function clampDim(n: number): 0 | 1 | 2 | 3 {
  const v = Math.round(Math.max(0, Math.min(3, n)));
  return v as 0 | 1 | 2 | 3;
}

function buildTrust(
  badge: FacilityDetailResponse["trust_badge"],
  fallbackScore: number
): FacilityTrust {
  if (!badge) {
    const dim = clampDim(Math.round(fallbackScore * 3));
    return {
      existence: dim,
      coherence: dim,
      recency: dim,
      specificity: dim,
      score: fallbackScore || 0,
    };
  }
  const e = clampDim(badge.existence);
  const c = clampDim(badge.coherence);
  const r = clampDim(badge.recency);
  const s = clampDim(badge.specificity);
  const score = (e + c + r + s) / 12;
  return { existence: e, coherence: c, recency: r, specificity: s, score };
}

function buildCitations(
  facilityId: string,
  citationIds: string[],
  buffered: Map<string, RawCitation>
): FacilityCitation[] {
  return citationIds
    .map((cid) => buffered.get(cid))
    .filter((c): c is RawCitation => Boolean(c) && c!.facility_id === facilityId)
    .map((c) => ({
      id: c.citation_id,
      column: c.column,
      char_start: c.char_start,
      char_end: c.char_end,
      text: c.excerpt,
    }));
}

function buildCapabilities(
  primaryClaimId: string,
  juryByClaimId: Map<string, ConsensusResolvedData>
): CapabilityVerdict[] {
  const c = juryByClaimId.get(primaryClaimId);
  if (!c) return [];
  const agreeMap: Record<number, "3/3" | "2/3" | "1/3" | "0/3"> = {
    3: "3/3", 2: "2/3", 1: "1/3", 0: "0/3",
  };
  return [
    {
      name: c.title?.replace(/^Three judges verdict: '|'$/g, "") || c.claim,
      agree: agreeMap[c.agreement] ?? "0/3",
      verdict: c.verdict,
    },
  ];
}

function transformExclusion(raw: RawExclusion): ExcludedFacility {
  // Frontend district = backend "City · State" — split for display
  const parts = (raw.location || "").split("·").map((s) => s.trim());
  const district = parts[0] || raw.location || "";
  return {
    name: raw.name,
    district,
    type: raw.type,
    reason: raw.reason,
    verdict: raw.verdict === "out_of_scope" || raw.verdict === "low_trust"
      ? "partial"
      : (raw.verdict as "partial" | "unsupported"),
  };
}

async function fetchFacility(
  apiUrl: string,
  facilityId: string
): Promise<FacilityDetailResponse | null> {
  try {
    const r = await fetch(`${apiUrl}/facilities/${encodeURIComponent(facilityId)}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as FacilityDetailResponse;
  } catch {
    return null;
  }
}

async function hydrateCards(
  cards: RawRankedCard[],
  citationsById: Map<string, RawCitation>,
  juryByClaimId: Map<string, ConsensusResolvedData>,
  apiUrl: string
): Promise<RecommendedFacility[]> {
  const details = await Promise.all(
    cards.map((c) => fetchFacility(apiUrl, c.facility_id))
  );
  return cards.map((card, i) => {
    const detail = details[i];
    const trust = buildTrust(detail?.trust_badge ?? null, card.trust_score);
    const citations = buildCitations(card.facility_id, card.citation_ids, citationsById);
    const capabilities = buildCapabilities(card.primary_claim_id, juryByClaimId);
    const locationParts = (card.location || "").split("·").map((s) => s.trim());
    const district = detail?.city || locationParts[0] || "";
    const state = detail?.state || locationParts[1] || "";
    return {
      id: card.facility_id,
      name: card.name,
      type: detail?.type || card.type,
      state,
      district,
      latitude: detail?.lat ?? 0,
      longitude: detail?.lon ?? 0,
      distance_km: card.distance_km ?? 0,
      trust,
      capabilities,
      citations,
      description: detail?.description ?? "",
      prose: card.prose,
    };
  });
}

// ---------------------------------------------------------------------------
// Stream adapter (the main generator)
// ---------------------------------------------------------------------------

function parseSSEFrameRaw(frame: string): RawEvent | null {
  if (!frame.startsWith("data: ")) return null;
  const json = frame.slice(6);
  try {
    return JSON.parse(json) as RawEvent;
  } catch {
    return null;
  }
}

/**
 * Suppressed agent_step names — these wrap UI affordances that render via
 * other event types (jury panels, proposers panel, validator stamp), so the
 * wrapping agent_step_* events would create duplicate noise.
 */
const SUPPRESSED_AGENT_STEPS = new Set([
  "moa_propose", // ProposalsNode renders the section header itself
  "jury_lookup", // JuryPanel + grouped numbering carry the label
  "tiebreaker",  // tiebreaker attaches to the JuryPanel inline
  "validator",   // ValidatorNode renders the stamp from validator_check
]);

/**
 * Streams the backend SSE response and yields frontend-shape `StreamEvent`s.
 * Buffers jury/cards/citations/exclusions and synthesizes
 * `consensus_resolved` and `recommendations_ready` events at the right moments.
 */
export async function* streamFromBackend(query: string): AsyncGenerator<StreamEvent> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const resp = await fetch(`${apiUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }

  // Adapter state -----------------------------------------------------------
  const juryByClaimId = new Map<string, ConsensusResolvedData>();
  const cards: RawRankedCard[] = [];
  const citationsById = new Map<string, RawCitation>();
  const exclusions: RawExclusion[] = [];
  let candidatesConsidered = 0;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const raw = parseSSEFrameRaw(frame);
      if (!raw) continue;

      // Translate -------------------------------------------------------
      switch (raw.type) {
        case "thinking_delta": {
          const d = raw.data as unknown as RawThinkingDelta;
          yield { type: "thinking_delta", data: { text: d.text } };
          break;
        }

        case "agent_step_start": {
          const d = raw.data as unknown as RawAgentStepStart;
          if (SUPPRESSED_AGENT_STEPS.has(d.name)) break;
          yield {
            type: "agent_step_start",
            data: {
              step_id: d.name,
              name: d.name,
              label: d.label || d.name,
            },
          };
          break;
        }

        case "agent_step_end": {
          const d = raw.data as unknown as RawAgentStepEnd;
          if (SUPPRESSED_AGENT_STEPS.has(d.name)) break;
          yield {
            type: "agent_step_end",
            data: {
              step_id: d.name,
              name: d.name,
              summary: d.label || undefined,
              duration_ms: d.latency_ms,
            },
          };
          break;
        }

        case "tool_call": {
          const d = raw.data as unknown as RawToolCall;
          // Sniff candidate count from hybrid_retrieve summary
          if (d.name === "hybrid_retrieve" && typeof d.output_summary === "string") {
            const m = d.output_summary.match(/(\d+)\s*candidates?/i);
            if (m) candidatesConsidered = parseInt(m[1], 10);
          }
          // Coerce input to an object for the frontend renderer
          const input = typeof d.input === "string"
            ? { query: d.input }
            : (d.input as Record<string, unknown> | undefined);
          yield {
            type: "tool_call",
            data: {
              tool: d.name,
              input,
              output_summary: d.output_summary,
              duration_ms: d.runtime_ms,
            },
          };
          break;
        }

        case "model_proposal": {
          const d = raw.data as unknown as RawModelProposal;
          yield {
            type: "model_proposal",
            data: {
              proposer_id: d.slot,
              vendor: vendorDisplay(d.vendor, d.model),
              title: "Two proposers ran in parallel",
              text: summarizeProposerContent(d.content),
            },
          };
          break;
        }

        case "jury_verdict": {
          const d = raw.data as unknown as RawJuryVerdict;
          const consensus = transformJury(d);
          juryByClaimId.set(d.claim_id, consensus);
          yield { type: "consensus_resolved", data: consensus };
          break;
        }

        case "tiebreaker_resolved": {
          // Hero queries Q1/Q2 don't trigger tiebreakers in the current
          // dataset, so the matching jury panel is already rendered by the
          // time this arrives. Surface the tiebreaker as its own consensus
          // re-emit (same panel, now with tiebreaker attached) — a future
          // improvement would mutate the original panel via context.
          const d = raw.data as unknown as RawTiebreaker;
          const original = juryByClaimId.get(d.claim_id);
          if (original) {
            const next: ConsensusResolvedData = {
              ...original,
              verdict: d.final_verdict,
              tiebreaker: {
                model: modelDisplayName(d.model),
                verdict: d.final_verdict,
                reasoning: d.rationale,
              },
            };
            juryByClaimId.set(d.claim_id, next);
            yield { type: "consensus_resolved", data: next };
          }
          break;
        }

        case "validator_check": {
          const d = raw.data as unknown as RawValidatorCheck;
          yield {
            type: "validator_pass",
            data: {
              title: `Validator · ${modelDisplayName(d.model)} (fresh context)`,
              body: d.message || "Independent re-check complete.",
              passed: d.status === "approved",
            },
          };
          break;
        }

        case "ranked_card": {
          cards.push(raw.data as unknown as RawRankedCard);
          break;
        }

        case "citation": {
          const c = raw.data as unknown as RawCitation;
          citationsById.set(c.citation_id, c);
          yield { type: "citation", data: c };
          break;
        }

        case "text_delta": {
          const d = raw.data as { text: string };
          yield { type: "text_delta", data: { text: d.text } };
          break;
        }

        case "exclusion": {
          exclusions.push(raw.data as unknown as RawExclusion);
          break;
        }

        case "stream_complete": {
          const d = raw.data as unknown as RawStreamComplete;
          const facilities = await hydrateCards(
            cards,
            citationsById,
            juryByClaimId,
            apiUrl
          );
          yield {
            type: "recommendations_ready",
            data: {
              facilities,
              excluded: exclusions.map(transformExclusion),
              pipeline_ms: d.total_latency_ms,
              candidates_considered: candidatesConsidered || cards.length,
            },
          };
          break;
        }

        case "error": {
          const d = raw.data as unknown as RawError;
          yield { type: "error", data: { message: d.message } };
          break;
        }

        default:
          // Unknown event type — ignore silently
          break;
      }
    }
  }
}
