import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { mockStreamQuery } = vi.hoisted(() => ({ mockStreamQuery: vi.fn() }));
vi.mock("@/lib/sse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sse")>("@/lib/sse");
  return { ...actual, streamQuery: mockStreamQuery };
});

import { useEventStream } from "@/lib/hooks/use-event-stream";

describe("useEventStream", () => {
  beforeEach(() => {
    mockStreamQuery.mockReset();
  });

  it("yields live events from the backend tagged as live", async () => {
    mockStreamQuery.mockImplementation(async function* () {
      yield { type: "thinking_delta", data: { text: "hi" } };
      yield { type: "text_delta", data: { text: "ok" } };
    });

    const { result } = renderHook(() =>
      useEventStream({ fallbackTimeoutMs: 60_000 })
    );
    await act(async () => {
      await result.current.run("test");
    });

    const live = result.current.events.filter((e) => e.__source === "live");
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(live[0]?.ev.type).toBe("thinking_delta");
  });

  it("appends demo fallback for missing event types after the live stream ends", async () => {
    mockStreamQuery.mockImplementation(async function* () {
      yield { type: "text_delta", data: { text: "answer" } };
    });

    const { result } = renderHook(() =>
      useEventStream({ fallbackTimeoutMs: 60_000, speed: 100 })
    );
    await act(async () => {
      await result.current.run("test");
    });

    await waitFor(
      () => {
        const types = result.current.events.map((e) => e.ev.type);
        expect(types).toContain("consensus_resolved");
        expect(types).toContain("recommendations_ready");
      },
      { timeout: 5000 }
    );

    const demoEvents = result.current.events.filter((e) => e.__source === "demo");
    expect(demoEvents.length).toBeGreaterThan(0);
  });
});
