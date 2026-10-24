"use client";

import { useState } from "react";
// Import from rubric/fix-plan/types directly: "@/lib/audit" pulls in server-only fetch code.
import { rankFixes, type FixItem } from "@/lib/audit/fix-plan";
import { CATEGORY_ORDER } from "@/lib/audit/rubric";
import type { CheckResult, Report } from "@/lib/audit/types";
import type { AgentTaskRun } from "../../../lib/agent/tasks";
import { ScoreRing, TONE, toneFor, type Tone } from "../ui";
import { AgentEvaluationProgress, type EvaluationStage } from "./AgentEvaluationProgress";
import { AgentSteps, AgentStrip, useAgentRun } from "./agent-section";
import { FixLinkBanner, FixLinkRepeat, useFixLink } from "./fix-link-button";
import { AREAS, TASK_CHECK, TASK_STUCK, goodFor, todoFor, whyFor } from "./plain";

const TOP_FIXES = 3;

// By the time ReportBody mounts, the checklist has run; the agent is what's left.
const AGENT_STAGES: EvaluationStage[] = [
  { id: "connecting", title: "Connecting", status: "complete" },
  { id: "connection", title: "Checking connection", status: "complete" },
  { id: "preparing", title: "Preparing tests", status: "complete" },
  { id: "running", title: "AI agent trying your site", status: "active" },
  { id: "scoring", title: "Calculating scores", status: "pending" },
  { id: "report", title: "Generating report", status: "pending" },
];
const WORKING_SHOWN = 9;

const AREA_WORD: Record<Tone, string> = { good: "Yes", warn: "Mostly", bad: "Not yet" };

const IMPACT: { min: number; label: string; tone: Tone | null }[] = [
  { min: 4, label: "Big impact", tone: "bad" },
  { min: 2, label: "Medium impact", tone: "warn" },
  { min: 0, label: "Small", tone: null },
];

const CHECK_STATUS: Record<CheckResult["status"], { label: string; className: string }> = {
  pass: { label: "PASS", className: TONE.good.text },
  warn: { label: "WARN", className: TONE.warn.text },
  fail: { label: "FAIL", className: TONE.bad.text },
  na: { label: "N/A", className: "text-muted" },
  unknown: { label: "NOT CHECKED", className: "text-muted" },
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

const joinAnd = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** Find / Use / Act, each averaged over the rubric categories measured enough to count. */
function areaScores(report: Report) {
  return AREAS.flatMap((area) => {
    const counted = area.categories.map((c) => report.categories[c]).filter((c) => c.countedInTotal && c.score != null);
    const weight = counted.reduce((s, c) => s + c.weight, 0);
    if (!weight) return [];
    const score = Math.round(counted.reduce((s, c) => s + c.score! * c.weight, 0) / weight);
    return [{ ...area, tone: toneFor(score) }];
  });
}

function verdict(areas: ReturnType<typeof areaScores>): string {
  const good = areas.filter((a) => a.tone === "good").map((a) => a.can);
  const weak = areas.filter((a) => a.tone !== "good").map((a) => a.can);
  if (!weak.length) return "AI assistants can find, read and use your site. Nice work.";
  if (!good.length) return `AI assistants struggle to ${joinAnd(weak)}.`;
  return `AI can ${joinAnd(good)}, but it struggles to ${joinAnd(weak)}.`;
}

/** Pairs each failed agent task with the first top fix it points to. */
function agentQuotes(fixes: FixItem[], tasks: AgentTaskRun[]): Map<string, AgentTaskRun> {
  const quotes = new Map<string, AgentTaskRun>();
  for (const t of tasks) {
    // Only the site's problems: an "error" run means the agent itself failed.
    if (t.result.status !== "failed" && t.result.status !== "blocked") continue;
    const fix = fixes.find((f) => TASK_CHECK[t.id]?.includes(f.id) && !quotes.has(f.id));
    if (fix) quotes.set(fix.id, t);
  }
  return quotes;
}

function WorkingList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2.5">
      {checks.map((c) => (
        <li key={c.id} className="flex items-center gap-3 rounded-[14px] bg-card px-4 py-3.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
            <path d="M5 12l5 5L20 7" />
          </svg>
          <span>{goodFor(c)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The scored part of the report. Shows one score: the final one, after the agent has tried the site
 * and /api/agent has re-scored and saved it. The progress card covers the wait.
 */
export function ReportBody({ checklistReport }: { checklistReport: Report & { score: number } }) {
  const [finalReport, setFinalReport] = useState<(Report & { score: number }) | null>(null);
  const agent = useAgentRun(checklistReport.url, (r) => r.score != null && setFinalReport(r as Report & { score: number }));
  // The fix link reads the saved final audit, which is stored under the final report's URL.
  const fixLink = useFixLink(finalReport?.url ?? checklistReport.url);
  if (agent.kind === "loading") return <AgentEvaluationProgress mode="live" stages={AGENT_STAGES} />;

  // The checklist-only report is a fallback for when the /api/agent request itself fails.
  const report = finalReport ?? checklistReport;

  const areas = areaScores(report);
  const fixes = rankFixes(report.checks);
  const top = fixes.slice(0, TOP_FIXES);
  const more = fixes.slice(TOP_FIXES);
  const quotes = agentQuotes(top, agent.kind === "done" ? agent.tasks : []);
  const working = report.checks.filter((c) => c.status === "pass");
  const hasProblems = report.checks.some((c) => c.status === "fail" || c.status === "warn");
  // Without a final report nothing was saved, so there's no audit to build a fix link from.
  const canLink = finalReport != null && fixes.length > 0;

  return (
    <>
      <section className="flex flex-col gap-6">
        <p className="text-[15px] text-muted">
          Report for <strong className="text-foreground">{new URL(report.url).hostname}</strong> · checked{" "}
          {new Date(report.auditedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <div className="flex flex-wrap items-center gap-9 rounded-3xl border border-border bg-card p-7 sm:p-8">
          <ScoreRing score={report.score} caption={`Grade ${report.grade}`} />
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <h1 className="font-display text-[30px] leading-[1.12] font-bold tracking-[-0.02em] sm:text-[36px]">{verdict(areas)}</h1>
            <ul className="flex flex-wrap gap-2">
              {areas.map((a) => (
                <li key={a.key} className={`rounded-full px-3 py-1.5 text-[15px] ${TONE[a.tone].bg}`}>
                  <span className="text-muted">{a.label}</span> <strong className={TONE[a.tone].text}>{AREA_WORD[a.tone]}</strong>
                </li>
              ))}
            </ul>
            <AgentStrip state={agent} />
          </div>
        </div>
      </section>

      {canLink && <FixLinkBanner fix={fixLink} count={fixes.length} />}
      {!finalReport && fixes.length > 0 && (
        <p role="status" className={`rounded-3xl p-6 ${TONE.warn.bg}`}>
          Your fix link isn&apos;t available for this check because the AI agent didn&apos;t finish. Run the check again to get one.
        </p>
      )}
      {!hasProblems && (
        <section className={`rounded-3xl p-8 ${TONE.good.bg}`}>
          <h2 className="font-display text-[28px] font-bold">Nothing left to fix from this check.</h2>
          <p className="mt-1 text-muted">AI assistants can read and use your site. Check again after big website changes.</p>
        </section>
      )}

      {top.length > 0 && (
        <section className="flex flex-col gap-5">
          <h2 className="font-display text-[30px] font-bold tracking-[-0.02em]">
            {top.length === 1 ? "Fix this first" : `Fix these ${top.length} things first`}
          </h2>
          <ol className="flex flex-col gap-3.5">
            {top.map((f, i) => {
              const impact = IMPACT.find((x) => f.points >= x.min)!;
              const task = quotes.get(f.id);
              return (
                <li key={f.id} className="flex items-start gap-5 rounded-[20px] border border-border bg-card p-6">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-strong text-[19px] font-bold text-white"
                  >
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-auto flex-col gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <h3 className="text-[21px] font-semibold">{todoFor(f)}</h3>
                      <span
                        className={`rounded-full px-3 py-0.5 text-sm font-bold ${impact.tone ? `${TONE[impact.tone].bg} ${TONE[impact.tone].text}` : "bg-border text-muted"}`}
                      >
                        {impact.label}
                      </span>
                    </div>
                    <p className="text-muted">{whyFor(f)}</p>
                    {task && (
                      <figure className="flex flex-col gap-1 rounded-[14px] bg-background px-4 py-3.5">
                        <figcaption className="text-sm font-semibold text-muted">We asked an AI agent to {task.title.toLowerCase()}</figcaption>
                        <p>
                          {task.result.status === "blocked" ? "Your site blocked it." : (TASK_STUCK[task.id] ?? "It got stuck.")}
                        </p>
                      </figure>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {canLink && <FixLinkRepeat fix={fixLink} count={fixes.length} />}
        </section>
      )}

      {more.length > 0 && (
        <details className="rounded-[20px] border border-border bg-card px-6 py-5">
          <summary className="cursor-pointer text-[19px] font-bold">
            {more.length === 1 ? "1 more thing you may want to fix" : `${more.length} more things you may want to fix`}
          </summary>
          <ul className="mt-4 flex flex-col gap-3">
            {more.map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 rounded-[14px] bg-background px-4 py-3.5">
                <strong>{todoFor(f)}</strong>
                <span className="text-muted">{whyFor(f)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[15px] text-muted">These are in your fix link too.</p>
        </details>
      )}

      {working.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">
            Already working <span className="text-good">({working.length})</span>
          </h2>
          <WorkingList checks={working.slice(0, WORKING_SHOWN)} />
          {working.length > WORKING_SHOWN && (
            <details>
              <summary className="cursor-pointer font-semibold text-muted">Show {working.length - WORKING_SHOWN} more</summary>
              <div className="mt-2.5">
                <WorkingList checks={working.slice(WORKING_SHOWN)} />
              </div>
            </details>
          )}
        </section>
      )}

      <details className="rounded-2xl border border-border bg-band px-5 py-[18px]">
        <summary className="cursor-pointer font-semibold">Technical details for your web person</summary>
        <div className="mt-4 flex flex-col gap-6 font-mono text-[13px] text-muted">
          <p>
            Rubric {report.rubricVersion} · {pct(report.coverage)} of the checklist measured
            {report.taskSuccessRate != null ? ` · agent tasks ${pct(report.taskSuccessRate)} completed` : ""}
          </p>
          {CATEGORY_ORDER.map((cat) => {
            const c = report.categories[cat];
            return (
              <div key={cat} className="flex flex-col gap-2">
                <p className="font-sans text-sm font-semibold text-foreground">
                  {cat}. {c.label} {c.score != null ? `${c.score}/100` : "not scored"} · {pct(c.coverage)} measured
                </p>
                {report.checks
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <div key={r.id}>
                      <p>
                        <span className={CHECK_STATUS[r.status].className}>{CHECK_STATUS[r.status].label}</span> {r.id}: {r.detail}
                      </p>
                      {r.fix && r.status !== "pass" && <p className="pl-4 whitespace-pre-wrap">Fix: {r.fix}</p>}
                      {r.evidence && r.evidence.length > 0 && r.status !== "pass" && (
                        <ul className="pl-4 break-all">
                          {r.evidence.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
              </div>
            );
          })}
          {agent.kind === "done" && agent.tasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-sans text-sm font-semibold text-foreground">What the AI agent did</p>
              <AgentSteps tasks={agent.tasks} />
            </div>
          )}
          {agent.kind === "error" && <p>Agent run failed: {agent.message}</p>}
          {report.diagnostics.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-sans text-sm font-semibold text-foreground">Noticed, not scored</p>
              {report.diagnostics.map((d) => (
                <p key={d.id} className="break-all">
                  {d.title}: {d.detail}
                </p>
              ))}
            </div>
          )}
        </div>
      </details>
    </>
  );
}
