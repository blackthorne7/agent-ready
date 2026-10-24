import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_ORDER, runAudit, type CheckResult } from "@/lib/audit";
import { AuditForm } from "../audit-form";
import { ScoreRing, SiteFooter, SiteHeader, StatusRow, TONE, toneFor, type Tone } from "../ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ url?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { url } = await searchParams;
  return { title: url ? `Agent readiness report: ${url}` : "Agent readiness report" };
}

const STATUS_STYLE: Record<CheckResult["status"], { label: string; className: string }> = {
  pass: { label: "Pass", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  warn: { label: "Improve", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  fail: { label: "Fail", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  na: { label: "N/A", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" },
  unknown: { label: "Not measured yet", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" },
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function scoreColor(score: number | null) {
  if (score == null) return "text-muted";
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

export default async function ReportPage({ searchParams }: Props) {
  const { url } = await searchParams;
  if (!url) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <AuditForm />
      </main>
    );
  }

  const report = await runAudit(url);
  const order = CATEGORY_ORDER;
  const cookies = report.checks.filter((c) => c.group === "cookies");

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-12">
        <div id="check">
          <AuditForm defaultValue={url ?? ""} />
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center">
            <div className="flex items-baseline gap-2">
              <span className={`text-6xl font-semibold tabular-nums ${scoreColor(report.score)}`}>{report.score ?? "—"}</span>
              <span className="text-muted">/ 100</span>
              <span className={`ml-2 text-3xl font-semibold ${scoreColor(report.score)}`}>{report.grade}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-medium">{report.url}</h1>
              <p className="text-sm text-muted">Audited {new Date(report.auditedAt).toUTCString()}</p>
              {report.evaluationStatus === "blocked_by_site" && (
                <p className="mt-1 text-sm text-red-600">
                  The site served a bot challenge instead of its content, so it couldn&apos;t be scored. This is not the same as a low score.
                </p>
              )}
              <p className="mt-1 text-sm text-muted">
                Coverage {pct(report.coverage)} of the rubric measured
                {report.taskSuccessRate != null ? ` · Agent tasks ${pct(report.taskSuccessRate)} succeeded` : " · No agent tasks run"}
              </p>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-3">
            {order.map((cat) => (
              <div key={cat} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted">
                  {cat}. {report.categories[cat].label}
                </p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${scoreColor(report.categories[cat].score)}`}>
                  {report.categories[cat].score ?? "—"}
                </p>
                <p className="text-xs text-muted">
                  {report.categories[cat].weight} pts · {pct(report.categories[cat].coverage)} measured
                  {report.categories[cat].score != null && !report.categories[cat].countedInTotal && " · too little measured to count"}
                </p>
              </div>
            </section>

            {ORDER.map((cat) => (
              <section key={cat} className="flex flex-col gap-3">
                <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">{PLAIN_LABELS[cat]}</h2>
                {report.checks
                  .filter((c) => c.category === cat)
                  .map((c) => {
                    const { tone, label } = CHECK_TONE[c.status];
                    return (
                      <article key={c.id} className="rounded-[20px] border border-border bg-card p-5">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-semibold">{c.title}</h3>
                          <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${TONE[tone].bg} ${TONE[tone].text}`}>{label}</span>
                        </div>
                        <p className="mt-1 text-muted">{c.detail}</p>
                        {c.fix && c.status !== "pass" && (
                          <pre className="mt-3 overflow-x-auto rounded-xl bg-band p-3 font-mono text-xs whitespace-pre-wrap text-foreground">{c.fix}</pre>
                        )}
                      </article>
                    );
                  })}
              </section>
            ))}
          </>
        )}
      </main>

          {order.map((cat) => (
            <section key={cat} className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">
                {cat}. {report.categories[cat].label}
              </h2>
              {report.checks
                .filter((c) => c.category === cat)
                .map((c) => (
                  <article key={c.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-medium">{c.title}</h3>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status].className}`}>
                        {STATUS_STYLE[c.status].label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{c.detail}</p>
                    {c.fix && c.status !== "pass" && (
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-xs">{c.fix}</pre>
                    )}
                    {c.evidence && c.evidence.length > 0 && c.status !== "pass" && (
                      <ul className="mt-2 list-disc pl-5 font-mono text-xs text-muted">
                        {c.evidence.map((e, i) => (
                          <li key={i} className="break-all">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
            </section>
          ))}

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Cookies, consent &amp; sessions</h2>
            <p className="text-sm text-muted">
              No separate score: each of these already counts once toward the category shown.{" "}
              {cookies.filter((c) => c.score != null).length} of {cookies.length} measured so far.
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {cookies.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <span>
                    {c.title} <span className="text-muted">({c.category})</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status].className}`}>
                    {STATUS_STYLE[c.status].label}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {report.diagnostics.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">Browser behaviors (recorded, not scored)</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {report.diagnostics.map((d) => (
                  <li key={d.id}>
                    <span className="font-medium">{d.title}:</span> <span className="break-all text-muted">{d.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
