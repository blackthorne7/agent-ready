import type { Metadata } from "next";
import Link from "next/link";
import { runAudit, type Category, type CheckResult } from "@/lib/audit";
import { AuditForm } from "../audit-form";
import { AgentSection } from "./agent-section";

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
};

function scoreColor(score: number) {
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
  const order: Category[] = ["access", "understand", "act"];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <nav className="flex flex-col gap-4">
        <Link href="/" className="font-mono text-sm text-emerald-600">
          ← agent ready
        </Link>
        <AuditForm defaultValue={url} />
      </nav>

      {report.error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <h1 className="font-medium">Couldn&apos;t audit {report.url}</h1>
          <p className="mt-1 text-sm">{report.error}</p>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center">
            <div className="flex items-baseline gap-2">
              <span className={`text-6xl font-semibold tabular-nums ${scoreColor(report.score)}`}>{report.score}</span>
              <span className="text-muted">/ 100</span>
              <span className={`ml-2 text-3xl font-semibold ${scoreColor(report.score)}`}>{report.grade}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-medium">{report.url}</h1>
              <p className="text-sm text-muted">Audited {new Date(report.auditedAt).toUTCString()}</p>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-3">
            {order.map((cat) => (
              <div key={cat} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted">{report.categories[cat].label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${scoreColor(report.categories[cat].score)}`}>{report.categories[cat].score}</p>
              </div>
            ))}
          </section>

          {order.map((cat) => (
            <section key={cat} className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{report.categories[cat].label}</h2>
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
                  </article>
                ))}
            </section>
          ))}

          <AgentSection url={report.url} />
        </>
      )}
    </main>
  );
}
