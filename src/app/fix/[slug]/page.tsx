import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildFixPrompt, rankFixes, scoreIfFixed } from "@/lib/audit/fix-plan";
import { logoUrl } from "@/lib/context-dev";
import { getFixLink } from "@/lib/fix-links";
import { SiteLogo } from "../../site-logo";
import { ScoreRing, SiteFooter, SiteHeader, TONE, toneFor } from "../../ui";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const link = await getFixLink((await params).slug);
  return { title: link ? `Fix plan for ${new URL(link.audit.url).hostname}` : "Fix plan" };
}

/** The page a business owner gets from "Get my fix link": what to change, and one prompt that does it. */
export default async function FixPage({ params }: Props) {
  const link = await getFixLink((await params).slug);
  if (!link) notFound();

  const host = new URL(link.audit.url).hostname;
  const items = rankFixes(link.audit.checks);
  const after = scoreIfFixed(
    link.audit.checks,
    items.map((i) => i.id),
  );
  const prompt = buildFixPrompt(link.audit.url, items, link);
  const files = [
    { name: "llms.txt", where: "Publish at /llms.txt", body: link.llmsTxt },
    { name: "Structured data (JSON-LD)", where: 'Inside <script type="application/ld+json"> in your homepage <head>', body: link.jsonLd },
    { name: "robots.txt", where: "Publish at /robots.txt (merge with any existing rules)", body: link.robotsTxt },
  ];

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main className="mx-auto flex max-w-[880px] flex-col gap-10 px-6 py-12">
        <section className="flex flex-wrap items-center gap-10 rounded-3xl border border-border bg-card p-8">
          <ScoreRing score={link.audit.score} caption={`Grade ${link.audit.grade} today`} />
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
            <p className="flex items-center gap-2 text-[15px] text-muted">
              <SiteLogo src={logoUrl(host.replace(/^www\./, ""))} size={24} />
              Fix plan for {host}
            </p>
            <h1 className="font-display text-[32px] leading-tight font-bold">Make your website easy for AI assistants to use</h1>
            {items.length > 0 ? (
              <p className="text-muted">
                Making the {items.length} changes below could raise your score from{" "}
                <strong className="text-foreground">{link.audit.score}</strong> to{" "}
                <strong className={TONE[toneFor(after)].text}>{after}</strong>.
              </p>
            ) : (
              <p className="text-muted">Nothing left to fix from this check. Nice work.</p>
            )}
          </div>
        </section>

        {items.length > 0 && (
          <>
            <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-8">
              <h2 className="font-display text-[26px] font-bold tracking-[-0.02em]">The easy way: copy and paste</h2>
              <p className="text-muted">
                You don&apos;t need to understand the technical details. Paste these instructions into your website builder&apos;s AI assistant (Wix,
                Squarespace, Shopify, Lovable) or Claude, or send this page to whoever looks after your website.
              </p>
              <div className="flex flex-wrap gap-3">
                <CopyButton text={prompt} label="Copy instructions" primary />
                <CopyButton label="Copy link to this page" />
              </div>
              <details className="text-[15px]">
                <summary className="cursor-pointer text-muted">Show the instructions</summary>
                <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-band p-4 font-mono text-xs whitespace-pre-wrap text-foreground">{prompt}</pre>
              </details>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="font-display text-[26px] font-bold tracking-[-0.02em]">What gets fixed, most important first</h2>
              <ol className="flex flex-col gap-3">
                {items.map((it, i) => (
                  <li key={it.id} className="rounded-[20px] border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">
                        {i + 1}. {it.title}
                      </h3>
                      {it.points > 0 && (
                        <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${TONE.good.bg} ${TONE.good.text}`}>+{it.points} {it.points === 1 ? "point" : "points"}</span>
                      )}
                    </div>
                    <p className="mt-1 text-muted">{it.detail}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="font-display text-[26px] font-bold tracking-[-0.02em]">The files, if you&apos;re doing it by hand</h2>
              <p className="-mt-1 text-[15px] text-muted">Already included in the instructions above. Replace every TODO with your real details.</p>
              {files.map((f) => (
                <details key={f.name} className="rounded-[20px] border border-border bg-card p-5">
                  <summary className="cursor-pointer font-semibold">
                    {f.name} <span className="font-normal text-muted">· {f.where}</span>
                  </summary>
                  <div className="mt-3 flex justify-end">
                    <CopyButton text={f.body} label="Copy" />
                  </div>
                  <pre className="mt-2 max-h-[320px] overflow-auto rounded-xl bg-band p-3 font-mono text-xs whitespace-pre-wrap text-foreground">{f.body}</pre>
                </details>
              ))}
            </section>
          </>
        )}

        <p className="text-[15px] text-muted">
          Based on our check on {new Date(link.audit.auditedAt).toUTCString()}. Made your changes?{" "}
          <Link href={`/report?url=${encodeURIComponent(link.audit.url)}`} className="text-accent-text">
            Check {host} again
          </Link>
          .
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
