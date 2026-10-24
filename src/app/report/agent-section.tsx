"use client";

import { useEffect, useState } from "react";
import type { Report } from "@/lib/audit/types";
import type { AgentTaskRun } from "../../../lib/agent/tasks";
import { TONE, type Tone } from "../ui";

const STATUS: Record<AgentTaskRun["result"]["status"], { tone: Tone; label: string }> = {
  success: { tone: "good", label: "Done" },
  failed: { tone: "bad", label: "Got stuck" },
  blocked: { tone: "bad", label: "Blocked" },
  error: { tone: "warn", label: "Didn't finish" },
};

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; tasks: AgentTaskRun[]; rescored: boolean };

/**
 * Sends an AI agent to try a few real tasks on the site, after the static report has rendered.
 * `onReport` receives the site re-scored with the agent's results; `onSettled` fires when the run ends either way.
 */
export function AgentSection({
  url,
  onReport,
  onSettled,
}: {
  url: string;
  onReport?: (report: Report) => void;
  onSettled?: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        if (cancelled) return;
        setState({ kind: "done", tasks: body.tasks, rescored: body.report?.score != null });
        if (body.report) onReport?.(body.report);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (!cancelled) onSettled?.();
      });
    return () => {
      cancelled = true;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps -- run once per URL, not when the parent re-renders

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Can an AI agent actually use it?</h2>
      <p className="text-muted">
        We sent an AI agent to the site to try a few common tasks, reading pages the way an agent does: no JavaScript,
        no logins, and no form submissions.
      </p>

      {state.kind === "loading" && (
        <div className="rounded-[20px] border border-border bg-card p-5 text-muted">
          The agent is working on the site. This usually takes under a minute, and the score above updates when it&apos;s done…
        </div>
      )}

      {state.kind === "error" && (
        <div role="alert" className="rounded-[20px] bg-bad-bg p-5">
          The agent couldn&apos;t run: {state.message}
        </div>
      )}

      {state.kind === "done" && state.rescored && (
        <p className="text-[15px] text-muted">The score above now includes these results.</p>
      )}

      {state.kind === "done" &&
        state.tasks.map((t) => (
          <article key={t.id} className="rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{t.title}</h3>
              <span
                className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${TONE[STATUS[t.result.status].tone].bg} ${TONE[STATUS[t.result.status].tone].text}`}
              >
                {STATUS[t.result.status].label}
              </span>
            </div>
            <p className="mt-1 text-muted">{t.result.reason}</p>
            {t.result.suggestedFix && t.result.status !== "success" && (
              <pre className="mt-3 overflow-x-auto rounded-xl bg-band p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                {t.result.suggestedFix}
              </pre>
            )}
            {t.steps.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">
                  {t.steps.length} step{t.steps.length === 1 ? "" : "s"}
                </summary>
                <ol className="mt-2 flex flex-col gap-1 font-mono text-xs">
                  {t.steps.map((s) => (
                    <li key={s.n} className="break-words">
                      {s.n}. {s.action}
                      {typeof s.args.url === "string" ? ` ${s.args.url}` : ""} — {s.observationSummary}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </article>
        ))}
    </section>
  );
}
