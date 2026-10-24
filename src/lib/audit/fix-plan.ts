// The fix plan behind a fix link (/fix/<slug>): failing checks ranked by how many points fixing
// each one would add, plus a prompt a business owner can paste into their site builder's AI
// (Wix, Squarespace, Lovable, Claude) or send to their developer.

// Imports only pure modules, so the report page can rank fixes in the browser.
import { CATEGORY_ORDER, scoreCategory, scoreTotal } from "./rubric";
import type { Category, CheckResult, TaskRun } from "./types";
import type { Fixes } from "./fixes";

export interface FixItem {
  id: string;
  category: Category;
  title: string;
  /** What's wrong, from the check. */
  detail: string;
  /** What to change, written for whoever edits the site. */
  fix: string;
  /** Points the overall score gains if this check passes, all else equal (0 for agent findings). */
  points: number;
  /** "agent": a task our AI agent got stuck on, which is the most site-specific finding. */
  source: "agent" | "check";
  /** Needs code or server access; a site builder's AI (Wix, Squarespace) can't do it. */
  developer: boolean;
}

// Checks whose fixes need a developer: server, hosting or application code changes.
const DEVELOPER_CHECKS = new Set([
  "server-rendered",
  "agent-protocols",
  "no-hidden-dom",
  "no-login-redirect",
  "readable-urls",
  "stable-selectors",
  "response-time",
  "no-bot-wall",
  "no-exposed-secrets",
  "cookie-security",
]);

// What matters most for each business type (business_types slugs in supabase/schema.sql), most
// important first. These checks go to the top of the list when failing; the rest follow by points.
const LOCAL_FIRST = ["business-info", "contact", "actions", "offerings", "forms-labeled", "structured-data"];
const FIRST_BY_TYPE: Record<string, string[]> = {
  restaurant: ["offerings", "business-info", "actions", "contact", "structured-data"],
  cafe: ["offerings", "business-info", "actions", "contact", "structured-data"],
  retail: ["offerings", "search-in-url", "actions", "structured-data", "business-info"],
  auto_shop: LOCAL_FIRST,
  salon: LOCAL_FIRST,
  clinic: LOCAL_FIRST,
  gym: LOCAL_FIRST,
  home: LOCAL_FIRST,
  tech: ["agent-protocols", "server-rendered", "llms-txt", "offerings", "forms-labeled"],
  media: ["server-rendered", "feeds", "heading-order", "structured-data", "sitemap"],
  government: ["contact", "business-info", "forms-labeled", "heading-order", "server-rendered"],
};

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

/** Tasks the AI agent failed or was blocked on, with its own reason and suggested fix. */
function agentFindings(tasks: TaskRun[]): FixItem[] {
  const seen = new Set<string>();
  return tasks
    .filter((t) => (t.status === "failed" || t.status === "blocked") && !seen.has(t.taskId) && seen.add(t.taskId))
    .map((t) => ({
      id: `agent-${t.taskId}`,
      category: "C" as const,
      title: `Our AI agent got stuck: ${t.title ?? t.goal}`,
      detail: t.reason,
      fix: t.fix ?? "Make this possible without running JavaScript, logging in or solving a captcha.",
      points: 0,
      source: "agent" as const,
      developer: false,
    }));
}

/**
 * What to fix, most useful first: the tasks our AI agent got stuck on (when `tasks` are given),
 * then failing or needs-work checks that have a fix: what matters most for the business type first,
 * then biggest score gain.
 */
export function rankFixes(checks: CheckResult[], tasks: TaskRun[] = [], limit = 8, businessType?: string): FixItem[] {
  const base = totalScore(checks);
  const first = FIRST_BY_TYPE[businessType ?? ""] ?? [];
  const priority = (id: string) => (first.includes(id) ? first.indexOf(id) : first.length);
  const fromChecks = (
    checks
      // Task checks record agent outcomes, not something to change; their causes show up in other checks.
      .filter((c) => c.fix && c.method !== "task" && (c.status === "fail" || c.status === "warn") && c.score != null)
      .map((check) => ({ check, points: Math.max(0, scoreIfFixed(checks, [check.id]) - base) }))
      .sort((a, b) => priority(a.check.id) - priority(b.check.id) || b.points - a.points || b.check.weight - a.check.weight)
      .map(({ check: c, points }) => ({
        id: c.id,
        category: c.category,
        title: c.title,
        detail: c.detail,
        fix: fixText(c.fix!),
        points,
        source: "check" as const,
        developer: DEVELOPER_CHECKS.has(c.id),
      }))
  );
  return [...agentFindings(tasks), ...fromChecks].slice(0, limit);
}

const numbered = (items: FixItem[]) =>
  items.map(
    (it, i) =>
      `${i + 1}. ${it.title}${it.source === "agent" ? " (found by an AI agent testing the site)" : ""}: ${it.detail}\n   Fix: ${it.fix.replace(/\n/g, "\n   ")}`,
  );

/** One prompt covering the ranked fixes and the drafted files. */
export function buildFixPrompt(siteUrl: string, items: FixItem[], files: Pick<Fixes, "llmsTxt" | "jsonLd" | "robotsTxt">): string {
  const origin = new URL(siteUrl).origin;
  const builder = items.filter((it) => !it.developer);
  const developer = items.filter((it) => it.developer);
  return [
    `I run the website ${origin}. An audit found that AI assistants (like ChatGPT, Claude and Perplexity) have trouble reading and using it.`,
    `Please make the changes below, most important first. Keep the site's design and wording the same otherwise.`,
    "",
    "## Changes",
    "",
    ...numbered(builder),
    ...(developer.length
      ? [
          "",
          "## For a developer",
          "",
          "These need code or server changes. If you're a website builder's AI (Wix, Squarespace, Shopify), skip them; the owner will pass them to their developer.",
          "",
          ...numbered(developer),
        ]
      : []),
    "",
    "## Files to add",
    "",
    "Fill in each TODO only with real details you know (address, opening hours, phone). If you don't know a value, delete that field or line instead; never publish the word TODO. If a file already exists, merge these lines into it instead of replacing it.",
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
