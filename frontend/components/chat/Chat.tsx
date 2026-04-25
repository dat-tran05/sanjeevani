"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { streamQuery, type StreamEvent } from "@/lib/sse";

interface TraceItem {
  name: string;
  summary?: string;
  status: "running" | "done";
}

export function Chat() {
  const [query, setQuery] = useState("rural Bihar emergency appendectomy with part-time doctors");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [thinking, setThinking] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [citations, setCitations] = useState<Array<{ facility_id: string; excerpt: string }>>([]);

  async function submit() {
    setRunning(true);
    setTrace([]);
    setThinking("");
    setAnswer("");
    setCitations([]);
    try {
      for await (const ev of streamQuery(query)) {
        handleEvent(ev);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "agent_step_start":
        setTrace((t) => [...t, {
          name: String(ev.data.name),
          summary: String(ev.data.summary ?? ""),
          status: "running",
        }]);
        break;
      case "agent_step_end":
        setTrace((t) => t.map((item, i) =>
          i === t.length - 1 || item.name === ev.data.name
            ? { ...item, status: "done", summary: String(ev.data.summary ?? item.summary ?? "") }
            : item
        ));
        break;
      case "thinking_delta":
        setThinking((s) => s + String(ev.data.text ?? ""));
        break;
      case "text_delta":
        setAnswer((s) => s + String(ev.data.text ?? ""));
        break;
      case "citation":
        setCitations((c) => [...c, {
          facility_id: String(ev.data.facility_id),
          excerpt: String(ev.data.excerpt),
        }]);
        break;
      case "error":
        setAnswer((s) => s + `\n\n[error] ${ev.data.message}`);
        break;
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4 p-6 max-w-7xl mx-auto">
      <Card className="col-span-12 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about Indian healthcare facilities..."
            disabled={running}
          />
          <Button type="submit" disabled={running}>
            {running ? "Thinking..." : "Send"}
          </Button>
        </form>
      </Card>

      <Card className="col-span-4 p-4 max-h-[70vh] overflow-y-auto">
        <h3 className="text-sm font-semibold mb-3 text-slate-600">Agent trace</h3>
        <ol className="space-y-2 text-sm">
          {trace.map((t, i) => (
            <li key={i} className="border-l-2 border-slate-300 pl-3">
              <div className="font-mono text-xs text-slate-500">
                {t.status === "running" ? "▶" : "✓"} {t.name}
              </div>
              {t.summary && <div className="text-slate-700">{t.summary}</div>}
            </li>
          ))}
          {trace.length === 0 && <li className="text-slate-400 italic">no activity</li>}
        </ol>
      </Card>

      <Card className="col-span-8 p-4 max-h-[70vh] overflow-y-auto">
        {thinking && (
          <div className="mb-4 p-3 bg-slate-50 italic text-slate-500 text-sm rounded">
            <div className="font-semibold mb-1 not-italic">Reasoning</div>
            {thinking}
          </div>
        )}
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">
          {answer || <span className="text-slate-400 italic">answer will stream here</span>}
        </div>
        {citations.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Citations</h4>
            <ul className="space-y-2 text-xs">
              {citations.map((c, i) => (
                <li key={i} className="font-mono text-slate-700">
                  <span className="text-slate-400">[{c.facility_id.slice(0, 8)}]</span>{" "}
                  {c.excerpt}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
