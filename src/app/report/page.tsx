import type { Metadata } from "next";
import { headers } from "next/headers";
import { runAudit } from "@/lib/audit";
import { logoUrl } from "@/lib/context-dev";
import { AUDIT_LIMIT_MESSAGE, takeAudit } from "@/lib/limits";
import { FIX_LINK_PRICE_LABEL, paywallEnabled } from "@/lib/payments";
import { AuditForm } from "../audit-form";
import { BlockedReport } from "./blocked-report";
import { SiteFooter, SiteHeader } from "../ui";
import { ReportBody } from "./report-body";

export const dynamic = "force-dynamic";

// checkout: the Stripe Checkout Session id Stripe adds when it sends the visitor back after paying.
type Props = { searchParams: Promise<{ url?: string; checkout?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { url } = await searchParams;
  return { title: url ? `Agent readiness report: ${url}` : "Agent readiness report" };
}

export default async function ReportPage({ searchParams }: Props) {
  const { url, checkout } = await searchParams;
  // Checklist only, and not saved: ReportBody waits for the agent's final score, which /api/agent saves.
  const limited = url ? !takeAudit(await headers()) : false;
  const report = url && !limited ? await runAudit(url) : null;

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main className="mx-auto flex max-w-[960px] flex-col gap-12 px-6 py-12">
        {/* A finished report keeps the page about that site; the header's "Get my score" checks another. */}
        {(!report || (report.score == null && !report.access)) && (
          <div id="check">
            <AuditForm defaultValue={url ?? ""} />
          </div>
        )}

        {limited && (
          <div role="alert" className="rounded-2xl bg-bad-bg p-6">
            <h1 className="font-display text-2xl font-bold">Couldn&apos;t check {url} right now</h1>
            <p className="mt-1 text-muted">{AUDIT_LIMIT_MESSAGE}</p>
          </div>
        )}

        {report?.error && (
          <div role="alert" className="rounded-2xl bg-bad-bg p-6">
            <h1 className="font-display text-2xl font-bold">Couldn&apos;t check {report.url}</h1>
            <p className="mt-1 text-muted">{report.error}</p>
          </div>
        )}

        {report?.evaluationStatus === "blocked_by_site" && report.access && (
          <BlockedReport report={{ ...report, access: report.access }} logoSrc={logoUrl(new URL(report.url).hostname.replace(/^www\./, ""))} />
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
            <ReportBody
              checklistReport={{ ...report, score: report.score }}
              logoSrc={logoUrl(new URL(report.url).hostname.replace(/^www\./, ""))}
              payment={{ required: paywallEnabled(), priceLabel: FIX_LINK_PRICE_LABEL, checkout }}
            />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
