import type { Metadata } from "next";
import { runAudit, type Category, type CheckResult } from "@/lib/audit";
import { AuditForm } from "../audit-form";
import { ScoreRing, SiteFooter, SiteHeader, StatusRow, TONE, toneFor, type Tone } from "../ui";
import { AgentSection } from "./agent-section";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ url?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { url } = await searchParams;
  return { title: url ? `Agent readiness report: ${url}` : "Agent readiness report" };
}

const ORDER: Category[] = ["access", "understand", "act"];

const PLAIN_LABELS: Record<Category, string> = {
  access: "Can AI find you?",
  understand: "Can AI understand you?",
  act: "Can AI act for customers?",
};

const CATEGORY_DETAIL: Record<Tone, string> = {
  good: "In good shape.",
  warn: "Some things to fix below.",
  bad: "Needs fixing, see below.",
};

const CHECK_TONE: Record<CheckResult["status"], { tone: Tone; label: string }> = {
  pass: { tone: "good", label: "Good" },
  warn: { tone: "warn", label: "Needs work" },
  fail: { tone: "bad", label: "Fix this" },
};

export default async function ReportPage({ searchParams }: Props) {
  const { url } = await searchParams;
  const report = url ? await runAudit(url) : null;

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-12">
        <div id="check">
          <AuditForm defaultValue={url ?? ""} />
        </div>

        {report?.error && (
          <div role="alert" className="rounded-2xl bg-bad-bg p-6">
            <h1 className="font-display text-2xl font-bold">Couldn&apos;t check {report.url}</h1>
            <p className="mt-1 text-muted">{report.error}</p>
          </div>
        )}

        {report && !report.error && (
          <>
            <section className="flex flex-wrap items-center gap-10 rounded-3xl border border-border bg-card p-8">
              <ScoreRing score={report.score} caption={`Grade ${report.grade}`} />
              <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
                <div>
                  <h1 className="truncate font-display text-[28px] font-bold">{new URL(report.url).hostname}</h1>
                  <p className="text-[15px] text-muted">Checked {new Date(report.auditedAt).toUTCString()}</p>
                </div>
                <div className="flex flex-col gap-3">
                  {ORDER.map((cat) => {
                    const tone = toneFor(report.categories[cat].score);
                    return (
                      <StatusRow
                        key={cat}
                        title={PLAIN_LABELS[cat]}
                        detail={CATEGORY_DETAIL[tone]}
                        tone={tone}
                        label={`${report.categories[cat].score}/100`}
                      />
                    );
                  })}
                </div>
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

            <AgentSection url={report.url} />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
