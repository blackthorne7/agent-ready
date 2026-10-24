import * as cheerio from "cheerio";
import { botChallenge, checks, collectDiagnostics } from "./checks";
import { assertPublicUrl, safeFetch } from "./fetch";
import { CATEGORIES, CATEGORY_ORDER, MIN_CATEGORY_COVERAGE, RUBRIC_VERSION } from "./rubric";
import type { AuditContext, Category, CategoryScore, Check, CheckResult, Fetched, Outcome, Report, Status, TaskRun } from "./types";

export type { Report, CheckResult, Category, TaskRun } from "./types";
export { CATEGORIES, CATEGORY_ORDER } from "./rubric";

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

/**
 * Category score = Σ(weight × rating/4) / Σ(weight) over checks that were measured,
 * scaled to 0-100. N/A checks drop out entirely; unknown checks only lower coverage.
 */
export function scoreCategory(cat: Category, results: CheckResult[]): CategoryScore {
  const inCat = results.filter((r) => r.category === cat && r.rating !== "na");
  const measured = inCat.filter((r) => r.score != null);
  const applicable = inCat.reduce((s, r) => s + r.weight, 0);
  const measuredWeight = measured.reduce((s, r) => s + r.weight, 0);
  const coverage = applicable ? measuredWeight / applicable : 0;
  const score = measuredWeight ? Math.round((measured.reduce((s, r) => s + r.score! * r.weight, 0) / measuredWeight) * 100) : null;
  return {
    label: CATEGORIES[cat].label,
    weight: CATEGORIES[cat].weight,
    score,
    coverage,
    countedInTotal: score != null && coverage >= MIN_CATEGORY_COVERAGE,
  };
}

/**
 * Total = category scores weighted 15/20/25/15/15/10, renormalized over the categories
 * measured enough to count (MIN_CATEGORY_COVERAGE). Coverage is reported alongside, never mixed in.
 */
export function scoreTotal(categories: Record<Category, CategoryScore>): { score: number | null; coverage: number } {
  const scored = CATEGORY_ORDER.filter((c) => categories[c].countedInTotal);
  const scoredWeight = scored.reduce((s, c) => s + categories[c].weight, 0);
  const allWeight = CATEGORY_ORDER.reduce((s, c) => s + categories[c].weight, 0);
  return {
    score: scoredWeight ? Math.round(scored.reduce((s, c) => s + categories[c].score! * categories[c].weight, 0) / scoredWeight) : null,
    coverage: Math.round((CATEGORY_ORDER.reduce((s, c) => s + categories[c].coverage * categories[c].weight, 0) / allWeight) * 100) / 100,
  };
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
    tasks,
    diagnostics: collectDiagnostics(ctx),
  };
}
