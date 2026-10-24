import Link from "next/link";

export type Tone = "good" | "warn" | "bad";

export const TONE: Record<Tone, { label: string; text: string; bg: string; ring: string }> = {
  good: { label: "Good", text: "text-good", bg: "bg-good-bg", ring: "var(--good)" },
  warn: { label: "Needs work", text: "text-warn", bg: "bg-warn-bg", ring: "var(--warn)" },
  bad: { label: "Missing", text: "text-bad", bg: "bg-bad-bg", ring: "var(--bad)" },
};

export function toneFor(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 40) return "warn";
  return "bad";
}

const NAV = [
  { href: "/#score", label: "The score" },
  { href: "/#steps", label: "How to fix" },
  { href: "/leaderboard", label: "Leaderboard", key: "leaderboard" },
  { href: "/#pricing", label: "Pricing" },
] as const;

/** On phones the links drop to their own row under the logo and button; from md up it's one row. */
export function SiteHeader({ current }: { current?: "leaderboard" } = {}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-[18px] md:gap-x-6">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[22px] font-bold text-foreground no-underline">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-base text-white">
            A
          </span>
          Agent Ready
        </Link>
        <nav aria-label="Main" className="order-last flex w-full items-center gap-6 md:order-none md:ml-auto md:w-auto">
          {NAV.map((item) => {
            const active = "key" in item && item.key === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`no-underline hover:text-accent-text ${active ? "font-semibold text-accent-text" : "text-foreground"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/#check" className="rounded-[10px] bg-white px-4 py-2.5 font-semibold text-black no-underline md:px-[18px]">
          Get my score
        </Link>
      </div>
    </header>
  );
}

export function ScoreRing({ score, caption }: { score: number; caption?: string }) {
  const tone = TONE[toneFor(score)];
  return (
    <div className="flex flex-[0_1_240px] flex-col items-center gap-3">
      <div
        className="flex h-[200px] w-[200px] items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${tone.ring} 0 ${score}%, var(--border-strong) ${score}% 100%)` }}
      >
        <div className="flex h-40 w-40 flex-col items-center justify-center rounded-full bg-card">
          <span className={`font-display text-[56px] leading-none font-bold tabular-nums ${tone.text}`}>{score}</span>
          <span className="text-sm text-muted">out of 100</span>
        </div>
      </div>
      {caption && <span className="text-[13px] text-muted">{caption}</span>}
    </div>
  );
}

export function StatusRow({ title, detail, tone, label }: { title: string; detail: string; tone: Tone; label?: string }) {
  const t = TONE[tone];
  return (
    <div className={`flex items-center justify-between gap-3.5 rounded-xl px-4 py-3.5 ${t.bg}`}>
      <span>
        <strong>{title}</strong> {detail}
      </span>
      <span className={`flex-none font-bold ${t.text}`}>{label ?? t.label}</span>
    </div>
  );
}

export function SiteFooter({ origin }: { origin?: string }) {
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-4 px-6 py-7 text-sm text-muted">
      <span>Agent Ready</span>
      {origin && (
        <span>
          For developers: MCP server at <code className="font-mono text-accent-text">{origin}/api/mcp</code>
        </span>
      )}
    </footer>
  );
}
