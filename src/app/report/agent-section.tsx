"use client";

import { useEffect, useRef, useState } from "react";
import type { Report } from "@/lib/audit/types";
import type { AgentTaskRun } from "../../../lib/agent/tasks";
import { TONE, type Tone } from "../ui";

export const AGENT_STATUS: Record<AgentTaskRun["result"]["status"], { tone: Tone; label: string }> = {
  success: { tone: "good", label: "Done" },
  failed: { tone: "bad", label: "Got stuck" },
  blocked: { tone: "bad", label: "Blocked" },
  error: { tone: "warn", label: "Didn't finish" },
};

export type AgentState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; tasks: AgentTaskRun[] };

/**
 * Sends an AI agent to try a few real tasks on the site, after the static report has rendered.
 * `onReport` receives the site re-scored with the agent's results. With `?fresh=1` in the address
 * (the fix page's "Check again"), the server skips its one-hour cached result and runs the agent again.
 */
export function useAgentRun(url: string, onReport: (report: Report) => void): AgentState {
  const [state, setState] = useState<AgentState>({ kind: "loading" });
  const fresh = useRef<boolean | null>(null);

  useEffect(() => {
    // Read once, then drop it from the address bar so a reload doesn't force another full run.
    if (fresh.current === null) {
      const params = new URLSearchParams(window.location.search);
      fresh.current = params.get("fresh") === "1";
      if (fresh.current) {
        params.delete("fresh");
        window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
      }
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, fresh: fresh.current }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        // No final score (e.g. the re-check hit a bot wall): nothing was saved, so treat it as a failed run.
        if (body.report?.score == null) throw new Error(body.report?.error ?? "The check didn't produce a final score");
        if (cancelled) return;
        setState({ kind: "done", tasks: body.tasks });
        onReport(body.report);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps -- run once per URL, not when the parent re-renders

  return state;
}

/** Under the verdict: what the agent tried and whether it worked. */
export function AgentStrip({ state }: { state: AgentState }) {
  if (state.kind === "loading") return null;
  // runAgent reports its own failures (no API key, model timeout) as "error" runs, which the score ignores.
  if (state.kind === "error" || state.tasks.every((t) => t.result.status === "error")) {
    return <p className="text-[15px] text-muted">AI task test didn&apos;t run this time, so this score is from our checklist only.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] text-muted">We sent an AI agent to try {state.tasks.length} things a customer would ask for:</p>
      <ul className="flex flex-wrap gap-2">
        {state.tasks.map((t) => {
          const s = AGENT_STATUS[t.result.status];
          return (
            <li key={t.id} className={`rounded-full px-3 py-1.5 text-[15px] ${TONE[s.tone].bg}`}>
              <span className="text-muted">{t.title}</span> <strong className={TONE[s.tone].text}>{s.label}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
