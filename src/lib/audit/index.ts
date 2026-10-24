import * as cheerio from "cheerio";
import { detectBusiness } from "./business";
import { describeBlock } from "./blocked";
import { botChallenge, checks, collectDiagnostics } from "./checks";
import { assertPublicUrl, safeFetch } from "./fetch";
import { CATEGORIES, CATEGORY_ORDER, RUBRIC_VERSION, scoreCategory, scoreTotal } from "./rubric";
import type { AuditContext, Category, CategoryScore, Check, CheckResult, Fetched, Outcome, Report, Status, TaskRun } from "./types";

export type { Report, CheckResult, Category, TaskRun } from "./types";
export { CATEGORIES, CATEGORY_ORDER, scoreCategory, scoreTotal } from "./rubric";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function grade(score: number | null): string {
  if (score == null) return "—";
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function statusOf(rating: CheckResult["rating"]): Status {
  if (rating === "na" || rating === "unknown") return rating;
  return rating >= 3 ? "pass" : rating === 2 ? "warn" : "fail";
}

function parseJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      (Array.isArray(data) ? data : [data]).forEach((d) => d && typeof d === "object" && out.push(d));
    } catch {
      // Malformed JSON-LD is ignored; the structured-data check will report it as missing.
    }
  });
  return out;
}

export async function runCheck(c: Check, ctx: AuditContext): Promise<CheckResult> {
  const base = { id: c.id, category: c.category, title: c.title, weight: c.weight, method: c.method, ...(c.group ? { group: c.group } : {}) };
  let outcome: Outcome;
  if (!c.run) {
    outcome = { rating: "unknown", detail: "Not measured yet: needs a real browser (Playwright)." };
  } else {
    try {
      outcome = await c.run(ctx);
    } catch (err) {
      // A crashed check is untested, not a failure.
      outcome = { rating: "unknown", detail: `Check errored: ${err instanceof Error ? err.message : err}` };
    }
  }
  const score = typeof outcome.rating === "number" ? outcome.rating / 4 : null;
  return { ...base, ...outcome, status: statusOf(outcome.rating), score };
}

export interface AuditOptions {
  /** Agent task runs (from lib/agent) that feed the task checks in categories C and E. */
  tasks?: TaskRun[];
}

export async function runAudit(input: string, { tasks = [] }: AuditOptions = {}): Promise<Report> {
  const auditedAt = new Date().toISOString();
  const empty = (url: string, error: string): Report => ({
    url,
    auditedAt,
    rubricVersion: RUBRIC_VERSION,
    evaluationStatus: "unreachable",
    score: null,
    grade: grade(null),
    coverage: 0,
    taskSuccessRate: null,
    categories: Object.fromEntries(
      CATEGORY_ORDER.map((c) => [c, { label: CATEGORIES[c].label, weight: CATEGORIES[c].weight, score: null, coverage: 0, countedInTotal: false }]),
    ) as Record<Category, CategoryScore>,
    checks: [],
    business: {},
    tasks,
    diagnostics: [],
    error,
  });

  const raw = normalizeUrl(input);
  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (err) {
    return empty(raw, err instanceof Error ? err.message : "Invalid URL");
  }

  const page = await safeFetch(url.toString());
  if (!page.body && page.error) return empty(url.toString(), `Could not load the page: ${page.error}`);

  const $ = cheerio.load(page.body);
  const cache = new Map<string, Promise<Fetched>>();
  const origin = new URL(page.url).origin;
  const ctx: AuditContext = {
    url: new URL(page.url),
    page,
    $,
    jsonLd: parseJsonLd($),
    fetchPath(path) {
      if (!cache.has(path)) cache.set(path, safeFetch(origin + path));
      return cache.get(path)!;
    },
    tasks,
  };

  const results = await Promise.all(checks.map((c) => runCheck(c, ctx)));
  const categories = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, scoreCategory(c, results)])) as Record<Category, CategoryScore>;
  // A challenge page says nothing about the real site, so it gets no score.
  const blocked = botChallenge(page) != null;
  const { score, coverage } = blocked ? { score: null, coverage: 0 } : scoreTotal(categories);
  const access = blocked ? await describeBlock(page, ctx.fetchPath) : undefined;
  const scoredTasks = tasks.filter((t) => t.status === "success" || t.status === "failed");

  return {
    url: ctx.url.toString(),
    auditedAt,
    rubricVersion: RUBRIC_VERSION,
    evaluationStatus: blocked ? "blocked_by_site" : "evaluated",
    score,
    grade: grade(score),
    coverage,
    taskSuccessRate: scoredTasks.length ? scoredTasks.filter((t) => t.status === "success").length / scoredTasks.length : null,
    categories,
    checks: results,
    business: detectBusiness(ctx),
    tasks,
    diagnostics: collectDiagnostics(ctx),
    ...(access && { access }),
  };
}
