import type { Metadata } from "next";
import { runAudit } from "@/lib/audit";
import { saveAudit } from "@/lib/audit/save";
import { AuditForm } from "../audit-form";
import { SiteFooter, SiteHeader } from "../ui";
import { ReportBody } from "./report-body";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ url?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { url } = await searchParams;
  return { title: url ? `Agent readiness report: ${url}` : "Agent readiness report" };
}

export default async function ReportPage({ searchParams }: Props) {
  const { url } = await searchParams;
  const report = url ? await runAudit(url) : null;
  if (report) await saveAudit(report);

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

        {report?.evaluationStatus === "blocked_by_site" && (
          <div role="alert" className="rounded-2xl bg-warn-bg p-6">
            <h1 className="font-display text-2xl font-bold">{new URL(report.url).hostname} blocked our check</h1>
            <p className="mt-1 text-muted">
              The site showed a bot challenge instead of its content, so it couldn&apos;t be scored. That isn&apos;t the same as a low score, but AI
              assistants are likely blocked the same way.
            </p>
          </div>
        )}

        {report && report.score != null && <ReportBody initialReport={{ ...report, score: report.score }} />}
      </main>

      <SiteFooter />
    </div>
  );
}
