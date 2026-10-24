import Link from "next/link";
import { BLOCKER_NAMES, CHECKER_UA_TOKEN, UNBLOCK_STEPS, type BlockedAccess, type FileAccess } from "@/lib/audit/blocked";
import { USER_AGENT } from "@/lib/audit/fetch";
import type { Report } from "@/lib/audit/types";
import { CopyButton } from "../fix/[slug]/copy-button";
import { SiteLogo } from "../site-logo";
import { RecordBlocked } from "./record-blocked";
import { StatusRow, TONE, type Tone } from "../ui";

type Row = { title: string; detail: string; tone: Tone; label: string };

const WALLED: Omit<Row, "title"> = { detail: "is behind the same block, so agents can't read it either.", tone: "bad", label: "Blocked" };

function fileRow(title: string, access: FileAccess, found: string, missing: string): Row {
  if (access === "blocked") return { title, ...WALLED };
  return access === "found" ? { title, detail: found, tone: "good", label: "Readable" } : { title, detail: missing, tone: "warn", label: "Missing" };
}

/** What agents can still read without getting past the block. */
function readableRows(a: BlockedAccess): Row[] {
  const robots: Row =
    a.robots === "blocked"
      ? { title: "robots.txt", ...WALLED }
      : a.robots === "missing"
        ? { title: "robots.txt", detail: "wasn't found. That's fine on its own: agents are allowed by default.", tone: "warn", label: "Missing" }
        : a.robotsBlocks.length
          ? { title: "robots.txt", detail: `also tells these AI agents to stay out: ${a.robotsBlocks.join(", ")}.`, tone: "bad", label: "Blocks AI" }
          : { title: "robots.txt", detail: "lets AI agents in, so the block comes from your firewall, not your rules.", tone: "good", label: "Allows AI" };
  return [
    robots,
    fileRow("llms.txt", a.llmsTxt, "is readable: assistants get a summary of your site even while the pages are blocked.", "isn't published. It's a short guide to your site written for AI assistants."),
    fileRow("Sitemap", a.sitemap, "is readable, so agents can see which pages exist.", "wasn't found, so agents have to guess which pages exist."),
  ];
}

/**
 * The report for a site that turned our checker away: no score (we can't see the site), but who
 * blocked us, how to let AI assistants in, and how the owner can let our checker in to get scored.
 */
export function BlockedReport({ report, logoSrc }: { report: Report & { access: BlockedAccess }; logoSrc: string | null }) {
  const { access } = report;
  const host = new URL(report.url).hostname;
  const blocker = access.blocker ? BLOCKER_NAMES[access.blocker] : null;
  const steps = UNBLOCK_STEPS[access.blocker ?? "unknown"];
  const checkAgain = `/report?url=${encodeURIComponent(report.url)}`;

  return (
    <>
      <RecordBlocked url={report.url} />
      <section className="flex flex-col gap-6">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-muted">
          <SiteLogo src={logoSrc} size={28} />
          <span>
            Report for <strong className="text-foreground">{host}</strong> · checked{" "}
            {new Date(report.auditedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-9 rounded-3xl border border-border bg-card p-7 sm:p-8">
          <div className="flex flex-[0_1_240px] flex-col items-center gap-3">
            <div className={`flex h-[200px] w-[200px] items-center justify-center rounded-full ${TONE.bad.bg}`}>
              <div className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full bg-card">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <span className={`font-display text-[26px] font-bold ${TONE.bad.text}`}>Blocked</span>
              </div>
            </div>
            <span className="text-[13px] text-muted">No score: we couldn&apos;t see the site</span>
          </div>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <h1 className="font-display text-[30px] leading-[1.12] font-bold tracking-[-0.02em] sm:text-[36px]">AI assistants can&apos;t get into your site.</h1>
            <p className="text-muted">
              {host} turned our checker away ({access.reason}
              {blocker && `, from ${blocker}`}). ChatGPT, Claude and other AI assistants visiting for your customers are most likely turned away the same way,
              so they can&apos;t read your pages or do anything for your customers.
            </p>
            <p className="text-muted">We only score what AI assistants can actually see, so there&apos;s no score until they can get in.</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[30px] font-bold tracking-[-0.02em]">How to let AI assistants in</h2>
        <p className="-mt-2 text-muted">
          {blocker
            ? `Your site is protected by ${blocker}. These are settings in your ${blocker} account; send this page to whoever looks after your website if that isn't you.`
            : "We couldn't tell which service blocked us. Send this page to whoever looks after your website."}
        </p>
        <ol className="flex flex-col gap-3.5">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-5 rounded-[20px] border border-border bg-card p-6">
              <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-strong text-[19px] font-bold text-white">
                {i + 1}
              </span>
              <p className="pt-2">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-[30px] font-bold tracking-[-0.02em]">What AI assistants can still read</h2>
        <div className="flex flex-col gap-2.5">
          {readableRows(access).map((r) => (
            <StatusRow key={r.title} {...r} />
          ))}
        </div>
      </section>

      <section id="allowlist" className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-7 sm:p-8">
        <h2 className="font-display text-[26px] font-bold tracking-[-0.02em]">Own this site? Let our checker in for your full score</h2>
        <p className="text-muted">
          Our checker says who it is: every request&apos;s user agent contains <strong className="font-mono text-foreground">{CHECKER_UA_TOKEN}</strong>. We never
          pretend to be ChatGPT or Claude, so allowing them doesn&apos;t let us in. Add the rule from the steps above, then check again.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-xl bg-band px-3 py-2 font-mono text-sm break-all">{USER_AGENT}</code>
          <CopyButton text={CHECKER_UA_TOKEN} label={`Copy "${CHECKER_UA_TOKEN}"`} />
        </div>
        <p className="text-[15px] text-muted">
          Anyone can send that user agent, so remove the rule after your check unless you&apos;re happy to leave it.
        </p>
        <div>
          <Link href={checkAgain} className="inline-block rounded-[10px] bg-accent px-[18px] py-2.5 font-semibold text-white hover:opacity-90">
            Check {host} again
          </Link>
        </div>
      </section>
    </>
  );
}
