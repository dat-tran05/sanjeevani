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
    expect(isLiveOnlyEvent("text_delta")).toBe(true);
    expect(isLiveOnlyEvent("citation")).toBe(true);
    expect(isLiveOnlyEvent("error")).toBe(true);
  });

  it("isLiveOnlyEvent rejects events the partner has not yet emitted", () => {
    expect(isLiveOnlyEvent("model_proposal")).toBe(false);
    expect(isLiveOnlyEvent("consensus_resolved")).toBe(false);
    expect(isLiveOnlyEvent("validator_pass")).toBe(false);
    expect(isLiveOnlyEvent("recommendations_ready")).toBe(false);
  });

  it("parseSSEFrame returns null for malformed frames", () => {
    expect(parseSSEFrame("comment line")).toBeNull();
    expect(parseSSEFrame("data: {malformed")).toBeNull();
    expect(parseSSEFrame("")).toBeNull();
  });

  it("parseSSEFrame returns event for valid frame", () => {
    const ev = parseSSEFrame('data: {"type":"text_delta","data":{"text":"x"}}');
    expect(ev).toEqual({ type: "text_delta", data: { text: "x" } });
  });
});
