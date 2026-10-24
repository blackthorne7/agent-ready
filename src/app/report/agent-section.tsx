"use client";

import { useEffect, useState } from "react";
import type { AgentTaskRun } from "../../../lib/agent/tasks";

const STATUS_STYLE: Record<AgentTaskRun["result"]["status"], { label: string; className: string }> = {
  success: { label: "Pass", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  failed: { label: "Fail", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  error: { label: "Error", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; tasks: AgentTaskRun[] };

/** Sends an AI agent to try a few real tasks on the site, after the static report has rendered. */
export function AgentSection({ url }: { url: string }) {
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
        if (!cancelled) setState({ kind: "done", tasks: body.tasks });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Can an AI agent actually use it?</h2>
      <p className="text-sm text-muted">
        We sent an AI agent to the site to try a few common tasks, reading pages the way an agent does: no JavaScript,
        no logins, and no form submissions.
      </p>

      {state.kind === "loading" && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted">
          The agent is working on the site. This usually takes under a minute…
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          The agent couldn&apos;t run: {state.message}
        </div>
      )}

      {state.kind === "done" &&
        state.tasks.map((t) => (
          <article key={t.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium">{t.title}</h3>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[t.result.status].className}`}>
                {STATUS_STYLE[t.result.status].label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{t.result.reason}</p>
            {t.result.suggestedFix && t.result.status !== "success" && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-xs">
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
