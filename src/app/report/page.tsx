import type { Metadata } from "next";
import { runAudit } from "@/lib/audit";
import { logoUrl } from "@/lib/context-dev";
import { AuditForm } from "../audit-form";
import { SiteFooter, SiteHeader } from "../ui";
import { ReportBody } from "./report-body";
import { AgentEvaluationProgress } from "./AgentEvaluationProgress";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ url?: string; demo?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { url } = await searchParams;
  return { title: url ? `Agent readiness report: ${url}` : "Agent readiness report" };
}

export default async function ReportPage({ searchParams }: Props) {
  const { url, demo } = await searchParams;
  if (demo === "1") {
    return (
      <div className="text-[17px] leading-[1.55]">
        <SiteHeader />
        <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-12">
          <AgentEvaluationProgress mode="demo" />
        </main>
        <SiteFooter />
      </div>
    );
  }
  // Checklist only, and not saved: ReportBody waits for the agent's final score, which /api/agent saves.
  const report = url ? await runAudit(url) : null;

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main className="mx-auto flex max-w-[960px] flex-col gap-12 px-6 py-12">
        {/* A finished report keeps the page about that site; the header's "Get my score" checks another. */}
        {(!report || report.score == null) && (
          <div id="check">
            <AuditForm defaultValue={url ?? ""} />
          </div>
        )}

        {report?.error && (
          <div role="alert" className="rounded-2xl bg-bad-bg p-6">
            <h1 className="font-display text-2xl font-bold">Couldn&apos;t check {report.url}</h1>
            <p className="mt-1 text-muted">{report.error}</p>
          </div>
        )}

        {report?.evaluationStatus === "blocked_by_site" && (
          <div role="alert" className="rounded-2xl bg-warn-bg p-6">
            <h1 className="font-display text-2xl font-bold">{new URL(report.url).hostname} blocked our check</h1>
            <p className="mt-1 text-muted">
              The site showed a bot challenge instead of its content, so it couldn&apos;t be scored. That isn&apos;t the same as a low score, but AI
              assistants are likely blocked the same way.
            </p>
          </div>
        )}

        {report && report.score != null && (
          <>
            {/* The final score needs the AI agent, which the page starts from the browser. */}
            <noscript>
              <p className="rounded-2xl bg-warn-bg p-6">
                The full report needs JavaScript. For a JSON report, use{" "}
                <a href={`/api/audit?url=${encodeURIComponent(report.url)}`} className="text-accent-text">
                  /api/audit
                </a>
                .
              </p>
            </noscript>
            <ReportBody checklistReport={{ ...report, score: report.score }} logoSrc={logoUrl(new URL(report.url).hostname.replace(/^www\./, ""))} />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
