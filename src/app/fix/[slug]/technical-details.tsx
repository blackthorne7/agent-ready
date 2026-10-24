import { CATEGORIES, CATEGORY_ORDER, scoreCategory } from "@/lib/audit/rubric";
import type { CheckResult } from "@/lib/audit/types";
import { TONE } from "../../ui";

const STATUS: Record<CheckResult["status"], { label: string; className: string }> = {
  fail: { label: "Fail", className: TONE.bad.text },
  warn: { label: "Needs work", className: TONE.warn.text },
  pass: { label: "Pass", className: TONE.good.text },
  na: { label: "Doesn't apply", className: "text-muted" },
  unknown: { label: "Not checked", className: "text-muted" },
};

const ORDER: CheckResult["status"][] = ["fail", "warn", "pass", "na", "unknown"];

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Every check from the saved audit, problems first, as plain visible text: whoever applies the fix
 * plan (a site builder's AI, a coding agent or a developer) reads it from this page.
 */
export function TechnicalDetails({ checks }: { checks: CheckResult[] }) {
  return (
    <section aria-labelledby="technical-details" className="flex flex-col gap-4">
      <div>
        <h2 id="technical-details" className="font-display text-[26px] font-bold tracking-[-0.02em]">
          Technical details for your web person
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          Every check we ran, by area, problems first. Each one says what we found and how to fix it. The AI agent&apos;s attempts are under
          &ldquo;{CATEGORIES.C.label}&rdquo;.
        </p>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const score = scoreCategory(cat, checks);
        const inCat = checks.filter((c) => c.category === cat).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
        if (!inCat.length) return null;
        return (
          <div key={cat} className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-5">
            <h3 className="font-semibold">
              {cat}. {CATEGORIES[cat].label}{" "}
              <span className="font-normal text-muted">
                {score.score != null ? `${score.score}/100` : "not scored"} · {pct(score.coverage)} measured
              </span>
            </h3>
            <ul className="flex flex-col gap-2.5 text-[15px]">
              {inCat.map((c) => (
                <li key={c.id}>
                  <p>
                    <strong className={STATUS[c.status].className}>{STATUS[c.status].label}:</strong> {c.title}{" "}
                    <code className="font-mono text-xs text-muted">({c.id})</code>
                  </p>
                  {c.status !== "pass" && <p className="text-muted">{c.detail}</p>}
                  {c.fix && (c.status === "fail" || c.status === "warn") && <p className="whitespace-pre-wrap">Fix: {c.fix}</p>}
                  {c.evidence && c.evidence.length > 0 && c.status !== "pass" && (
                    <ul className="mt-1 list-disc pl-5 font-mono text-xs break-all text-muted">
                      {c.evidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
