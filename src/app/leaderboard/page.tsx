import type { Metadata } from "next";
import Link from "next/link";
import { logoUrl } from "@/lib/context-dev";
import { getBlocked, getFilters, getLeaderboard } from "@/lib/leaderboard";
import { AuditForm } from "../audit-form";
import { SiteFooter, SiteHeader, TONE, toneFor } from "../ui";
import { SiteLogo } from "../site-logo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard: the most AI-ready websites",
  description: "Websites ranked by how well AI assistants can find them, understand them and act for customers. Filter by business type.",
};

type Props = { searchParams: Promise<{ type?: string | string[] }> };

// A repeated param (?type=a&type=b) arrives as an array; use the first.
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** A small version of the report's score ring, so the score reads the same everywhere. */
function ScoreDial({ score }: { score: number }) {
  const tone = TONE[toneFor(score)];
  const ring = "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.5px))";
  return (
    <span className="relative flex h-12 w-12 flex-none items-center justify-center">
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${tone.ring} 0 ${score}%, var(--border-strong) ${score}% 100%)`,
          mask: ring,
          WebkitMask: ring,
        }}
      />
      <span className={`font-display text-lg leading-none font-bold tabular-nums ${tone.text}`}>{score}</span>
      <span className="sr-only"> out of 100</span>
    </span>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const SELECT = `h-12 w-full cursor-pointer appearance-none rounded-xl border border-border-strong bg-card pr-10 pl-3.5 text-base font-normal text-foreground hover:border-muted ${FOCUS}`;

export default async function LeaderboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const type = one(params.type);
  const [filters, rows, blocked] = await Promise.all([getFilters(), getLeaderboard({ type }), getBlocked({ type })]);
  const typeLabel = (slug: string) => filters.types.find((t) => t.slug === slug)?.label ?? slug;

  // Type labels read as adjectives ("Auto Shop websites"), so no plural guessing.
  const scope = type ? `${typeLabel(type)} websites` : "All websites";
  const filtered = Boolean(type);

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader current="leaderboard" />

      <main className="mx-auto flex max-w-[1040px] flex-col gap-8 px-6 pt-12 pb-20 sm:pt-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[40px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[52px]">Leaderboard</h1>
          <p className="max-w-[640px] text-[19px] text-muted">Websites ranked by how well AI assistants can read them. Higher is better, 100 is perfect.</p>
        </div>

        {/* Plain GET form so filters work without JavaScript (agents use it too). */}
        <form action="/leaderboard" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold sm:w-[240px]">
            Business type
            <span className="relative">
              <select name="type" defaultValue={type ?? ""} className={SELECT}>
                <option value="">All types</option>
                {filters.types.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Chevron />
            </span>
          </label>
          <button type="submit" className={`h-12 cursor-pointer rounded-xl bg-accent px-6 font-bold text-white hover:brightness-110 ${FOCUS}`}>
            Show
          </button>
        </form>

        {rows === null ? (
          <p role="alert" className="rounded-2xl bg-bad-bg p-6">
            The leaderboard is unavailable right now. Please try again in a minute.
          </p>
        ) : (
          <section aria-labelledby="scope" className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
              <h2 id="scope" className="font-display text-[22px] leading-tight font-bold tracking-[-0.01em]">
                {scope}
              </h2>
              <p className="text-sm text-muted">
                {rows.length === 50 ? "Top 50" : rows.length > 0 && `${rows.length} ranked`}
                {filtered && (
                  <>
                    {rows.length > 0 && " · "}
                    <Link href="/leaderboard" className={`rounded font-semibold text-accent-text hover:text-foreground ${FOCUS}`}>
                      Clear filters
                    </Link>
                  </>
                )}
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col gap-1 px-5 py-10 text-center sm:px-6">
                <p className="text-[19px] font-semibold">No one here yet.</p>
                <p className="text-muted">Check your website below and you’ll be the first on this list.</p>
              </div>
            ) : (
              <ol className="divide-y divide-border">
                {rows.map((r) => {
                  const top = r.rank <= 3;
                  // Skip what the filter already says; the domain only shows from sm up (the name is enough on a phone).
                  const meta = [
                    r.name ? { text: r.domain, wide: true } : null,
                    type ? null : { text: typeLabel(r.business_type), wide: false },
                  ].filter((m) => m !== null);
                  return (
                    <li key={r.domain} value={r.rank}>
                      <Link
                        href={`/report?url=${encodeURIComponent(r.domain)}`}
                        className="flex items-center gap-3 px-4 py-3.5 text-foreground no-underline hover:bg-border/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:gap-4 sm:px-6"
                      >
                        <span
                          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full font-display text-base sm:h-9 sm:w-9 sm:text-[17px] font-bold tabular-nums ${
                            top ? "bg-accent-soft text-accent-text" : "text-muted"
                          }`}
                        >
                          {r.rank}
                        </span>
                        <SiteLogo src={logoUrl(r.domain)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{r.name ?? r.domain}</span>
                          {meta.length > 0 && (
                            <span className="flex flex-wrap gap-x-3 text-sm text-muted sm:gap-x-0">
                              {meta.map((m, i) => (
                                <span
                                  key={m.text}
                                  className={`${m.wide ? "hidden truncate sm:block" : "whitespace-nowrap"} ${i > 0 ? "sm:before:mx-2 sm:before:content-['·']" : ""}`}
                                >
                                  {m.text}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        <ScoreDial score={r.score} />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}

        {blocked.length > 0 && (
          <section aria-labelledby="blocked" className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:px-6">
              <h2 id="blocked" className="font-display text-[22px] leading-tight font-bold tracking-[-0.01em]">
                Blocking AI assistants
              </h2>
              <p className="text-sm text-muted">These websites turned our checker away, so AI assistants likely can&apos;t read them either. Not ranked: we only score what assistants can see.</p>
            </div>
            <ul className="divide-y divide-border">
              {blocked.map((r) => (
                <li key={r.domain}>
                  <Link
                    href={`/report?url=${encodeURIComponent(r.domain)}`}
                    className="flex items-center gap-3 px-4 py-3.5 text-foreground no-underline hover:bg-border/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:gap-4 sm:px-6"
                  >
                    <SiteLogo src={logoUrl(r.domain)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name ?? r.domain}</span>
                      <span className="flex flex-wrap gap-x-3 text-sm text-muted sm:gap-x-0">
                        {r.name && <span className="hidden truncate sm:block">{r.domain}</span>}
                        {!type && <span className={`whitespace-nowrap ${r.name ? "sm:before:mx-2 sm:before:content-['·']" : ""}`}>{typeLabel(r.business_type)}</span>}
                      </span>
                    </span>
                    <span className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${TONE.bad.bg} ${TONE.bad.text}`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      Blocked
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="cta" className="flex flex-col gap-4 rounded-3xl border border-border bg-band p-6 sm:p-8">
          <div className="flex flex-col gap-1">
            <h2 id="cta" className="font-display text-[28px] leading-tight font-bold tracking-[-0.02em]">
              Where does your website rank?
            </h2>
            <p className="text-muted">Get your free score in under a minute. Every website we check joins the leaderboard.</p>
          </div>
          <AuditForm id="leaderboard-url" />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
