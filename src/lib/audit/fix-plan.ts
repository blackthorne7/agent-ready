// The fix plan behind a fix link (/fix/<slug>): failing checks ranked by how many points fixing
// each one would add, plus a prompt a business owner can paste into their site builder's AI
// (Wix, Squarespace, Lovable, Claude) or send to their developer.

// Imports only pure modules, so the report page can rank fixes in the browser.
import { CATEGORY_ORDER, scoreCategory, scoreTotal } from "./rubric";
import type { Category, CheckResult } from "./types";
import type { Fixes } from "./fixes";

export interface FixItem {
  id: string;
  category: Category;
  title: string;
  /** What's wrong, from the check. */
  detail: string;
  /** What to change, written for whoever edits the site. */
  fix: string;
  /** Points the overall score gains if this check passes, all else equal. */
  points: number;
}

function totalScore(checks: CheckResult[]): number {
  const categories = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, scoreCategory(c, checks)])) as Record<
    Category,
    ReturnType<typeof scoreCategory>
  >;
  return scoreTotal(categories).score ?? 0;
}

// Some fix texts point at the MCP tool that drafts these files; the fix page includes them directly.
function fixText(fix: string): string {
  if (!fix.includes("generate_fixes")) return fix;
  return fix.includes("llms.txt")
    ? "Publish the llms.txt file below at /llms.txt."
    : "Add the structured data (JSON-LD) below to the homepage's <head>.";
}

/** The overall score if the given checks all passed, all else equal. */
export function scoreIfFixed(checks: CheckResult[], ids: string[]): number {
  const fix = new Set(ids);
  return totalScore(checks.map((c) => (fix.has(c.id) ? { ...c, rating: 4 as const, score: 1, status: "pass" as const } : c)));
}

/** Failing or needs-work checks that have a fix, biggest score gain first. */
export function rankFixes(checks: CheckResult[], limit = 8): FixItem[] {
  const base = totalScore(checks);
  return (
    checks
      // Task checks record agent outcomes, not something to change; their causes show up in other checks.
      .filter((c) => c.fix && c.method !== "task" && (c.status === "fail" || c.status === "warn") && c.score != null)
      .map((check) => ({ check, points: Math.max(0, scoreIfFixed(checks, [check.id]) - base) }))
      .sort((a, b) => b.points - a.points || b.check.weight - a.check.weight)
      .slice(0, limit)
      .map(({ check: c, points }) => ({ id: c.id, category: c.category, title: c.title, detail: c.detail, fix: fixText(c.fix!), points }))
  );
}

/** One prompt covering the ranked fixes and the drafted files. */
export function buildFixPrompt(siteUrl: string, items: FixItem[], files: Pick<Fixes, "llmsTxt" | "jsonLd" | "robotsTxt">): string {
  const origin = new URL(siteUrl).origin;
  return [
    `I run the website ${origin}. An audit found that AI assistants (like ChatGPT, Claude and Perplexity) have trouble reading and using it.`,
    `Please make the changes below, most important first. Keep the site's design and wording the same otherwise.`,
    "",
    "## Changes",
    "",
    ...items.map((it, i) => `${i + 1}. ${it.title}: ${it.detail}\n   Fix: ${it.fix.replace(/\n/g, "\n   ")}`),
    "",
    "## Files to add",
    "",
    "Replace every TODO with the business's real details (address, opening hours, phone). If a file already exists, merge these lines into it instead of replacing it.",
    "",
    "1. /llms.txt (a plain-text summary for AI assistants):",
    "```",
    files.llmsTxt.trim(),
    "```",
    "",
    "2. Structured data, inside a <script type=\"application/ld+json\"> tag in the homepage <head>:",
    "```json",
    files.jsonLd.trim(),
    "```",
    "",
    "3. /robots.txt (keep any existing rules that block private pages):",
    "```",
    files.robotsTxt.trim(),
    "```",
  ].join("\n");
}
