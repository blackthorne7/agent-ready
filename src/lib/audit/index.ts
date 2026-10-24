import * as cheerio from "cheerio";
import { detectBusiness } from "./business";
import { checks } from "./checks";
import { assertPublicUrl, safeFetch } from "./fetch";
import type { AuditContext, Category, CheckResult, Fetched, Report } from "./types";

export type { Report, CheckResult, Category } from "./types";

export const CATEGORY_LABELS: Record<Category, string> = {
  access: "Can agents get in?",
  understand: "Can agents understand it?",
  act: "Can agents take action?",
};

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function grade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function weighted(results: CheckResult[]): number {
  const total = results.reduce((s, r) => s + r.weight, 0);
  if (!total) return 0;
  return Math.round((results.reduce((s, r) => s + r.score * r.weight, 0) / total) * 100);
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

export async function runAudit(input: string): Promise<Report> {
  const auditedAt = new Date().toISOString();
  const empty = (url: string, error: string): Report => ({
    url,
    auditedAt,
    score: 0,
    grade: "F",
    categories: {
      access: { score: 0, label: CATEGORY_LABELS.access },
      understand: { score: 0, label: CATEGORY_LABELS.understand },
      act: { score: 0, label: CATEGORY_LABELS.act },
    },
    checks: [],
    business: {},
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
  };

  const results = await Promise.all(
    checks.map(async (c): Promise<CheckResult> => {
      const base = { id: c.id, category: c.category, title: c.title, weight: c.weight };
      try {
        return { ...base, ...(await c.run(ctx)) };
      } catch (err) {
        return { ...base, status: "warn", score: 0, detail: `Check errored: ${err instanceof Error ? err.message : err}` };
      }
    }),
  );

  const byCat = (cat: Category) => weighted(results.filter((r) => r.category === cat));
  const score = weighted(results);
  return {
    url: ctx.url.toString(),
    auditedAt,
    score,
    grade: grade(score),
    categories: {
      access: { score: byCat("access"), label: CATEGORY_LABELS.access },
      understand: { score: byCat("understand"), label: CATEGORY_LABELS.understand },
      act: { score: byCat("act"), label: CATEGORY_LABELS.act },
    },
    checks: results,
    business: detectBusiness(ctx),
  };
}
