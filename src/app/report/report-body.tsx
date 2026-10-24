"use client";

import { useState } from "react";
// Import from rubric/types directly: "@/lib/audit" pulls in server-only fetch code.
import { CATEGORY_ORDER } from "@/lib/audit/rubric";
import type { Category, CheckResult, Report } from "@/lib/audit/types";
import { ScoreRing, StatusRow, TONE, toneFor, type Tone } from "../ui";
import { AgentSection } from "./agent-section";
import { FixLinkButton } from "./fix-link-button";

// Plain-language versions of the A-F rubric labels in src/lib/audit/rubric.ts.
const PLAIN_LABELS: Record<Category, string> = {
  A: "Can AI find and read you?",
  B: "Can AI understand your buttons and forms?",
  C: "Can AI finish tasks for customers?",
  D: "Can AI connect to you directly?",
  E: "Does it work reliably for AI?",
  F: "Is it safe for AI to use?",
};

const CATEGORY_DETAIL: Record<Tone, string> = {
  good: "In good shape.",
  warn: "Some things to fix below.",
  bad: "Needs fixing, see below.",
};

const NEUTRAL = "bg-band text-muted";

const CHECK_TONE: Record<CheckResult["status"], { className: string; label: string }> = {
  pass: { className: `${TONE.good.bg} ${TONE.good.text}`, label: "Good" },
  warn: { className: `${TONE.warn.bg} ${TONE.warn.text}`, label: "Needs work" },
  fail: { className: `${TONE.bad.bg} ${TONE.bad.text}`, label: "Fix this" },
  na: { className: NEUTRAL, label: "Doesn't apply" },
  unknown: { className: NEUTRAL, label: "Not checked yet" },
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The scored part of the report. Client-side so it can switch to the re-scored report the agent
 * section returns, which includes the rubric's task-based checks.
 */
export function ReportBody({ initialReport }: { initialReport: Report & { score: number } }) {
  const [report, setReport] = useState(initialReport);
  const [agentDone, setAgentDone] = useState(false);
  const cookies = report.checks.filter((c) => c.group === "cookies");

  return (
    <>
      <section className="flex flex-wrap items-center gap-10 rounded-3xl border border-border bg-card p-8">
        <ScoreRing score={report.score} caption={`Grade ${report.grade}`} />
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
          <div>
            <h1 className="truncate font-display text-[28px] font-bold">{new URL(report.url).hostname}</h1>
            <p className="text-[15px] text-muted">Checked {new Date(report.auditedAt).toUTCString()}</p>
            <p className="text-[15px] text-muted">
              {pct(report.coverage)} of the checklist measured
              {report.taskSuccessRate != null ? ` · AI tasks ${pct(report.taskSuccessRate)} completed` : " · AI task tests not run"}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {CATEGORY_ORDER.map((cat) => {
              const c = report.categories[cat];
              if (c.score == null || !c.countedInTotal) {
                return (
                  <div key={cat} className={`flex items-center justify-between gap-3.5 rounded-xl px-4 py-3.5 ${NEUTRAL}`}>
                    <span>
                      <strong className="text-foreground">{PLAIN_LABELS[cat]}</strong> Not enough measured yet.
                    </span>
                    <span className="flex-none font-bold">{pct(c.coverage)}</span>
                  </div>
                );
              }
              const tone = toneFor(c.score);
              return <StatusRow key={cat} title={PLAIN_LABELS[cat]} detail={CATEGORY_DETAIL[tone]} tone={tone} label={`${c.score}/100`} />;
            })}
          </div>
        </div>
      </section>

      {CATEGORY_ORDER.map((cat) => (
        <section key={cat} className="flex flex-col gap-3">
          <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">{PLAIN_LABELS[cat]}</h2>
          <p className="-mt-2 text-[15px] text-muted">
            {report.categories[cat].weight} of 100 points · {pct(report.categories[cat].coverage)} measured
          </p>
          {report.checks
            .filter((c) => c.category === cat)
            .map((c) => {
              const { className, label } = CHECK_TONE[c.status];
              return (
                <article key={c.id} className="rounded-[20px] border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{c.title}</h3>
                    <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${className}`}>{label}</span>
                  </div>
                  <p className="mt-1 text-muted">{c.detail}</p>
                  {c.fix && c.status !== "pass" && (
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-band p-3 font-mono text-xs whitespace-pre-wrap text-foreground">{c.fix}</pre>
                  )}
                  {c.evidence && c.evidence.length > 0 && c.status !== "pass" && (
                    <ul className="mt-2 list-disc pl-5 font-mono text-xs break-all text-muted">
                      {c.evidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Cookies, consent and sessions</h2>
        <p className="-mt-2 text-[15px] text-muted">
          No separate score: each of these already counts once in the section shown. {cookies.filter((c) => c.score != null).length} of{" "}
          {cookies.length} measured so far.
        </p>
        <ul className="flex flex-col gap-2">
          {cookies.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <span>
                {c.title} <span className="text-muted">({PLAIN_LABELS[c.category]})</span>
              </span>
              <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${CHECK_TONE[c.status].className}`}>{CHECK_TONE[c.status].label}</span>
            </li>
          ))}
        </ul>
      </section>

      {report.diagnostics.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">What else we noticed</h2>
          <p className="-mt-2 text-[15px] text-muted">Recorded for context, not scored.</p>
          <ul className="flex flex-col gap-1">
            {report.diagnostics.map((d) => (
              <li key={d.id}>
                <strong>{d.title}:</strong> <span className="break-all text-muted">{d.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AgentSection
        url={report.url}
        onReport={(r) => r.score != null && setReport(r as Report & { score: number })}
        onSettled={() => setAgentDone(true)}
      />

      <FixLinkButton url={report.url} ready={agentDone} />
    </>
  );
}
