/**
 * Custom SSE consumer for our event taxonomy.
 * Reads a POST → text/event-stream response and yields parsed events.
 */
export type EventType =
  | "thinking_delta"
  | "agent_step_start"
  | "agent_step_end"
  | "tool_call"
  | "model_proposal"
  | "consensus_resolved"
  | "text_delta"
  | "citation"
  | "error";

export interface StreamEvent {
  type: EventType;
  data: Record<string, unknown>;
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

    // SSE frames are delimited by \n\n
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith("data: ")) {
        const json = frame.slice(6);
        try {
          yield JSON.parse(json) as StreamEvent;
        } catch (e) {
          // skip malformed frame
          console.warn("malformed SSE frame", e);
        }
      }
    }
  }
}
