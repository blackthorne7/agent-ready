import type { Category, CategoryScore, CheckResult } from "./types";

// Category weights are hypotheses from evals/AGENT_CHECKS.md, to be calibrated later.
export const RUBRIC_VERSION = "agent-0.1";

export const CATEGORIES: Record<Category, { label: string; weight: number }> = {
  A: { label: "Can agents find and read the content?", weight: 15 },
  B: { label: "Can agents understand the controls?", weight: 20 },
  C: { label: "Can agents complete tasks?", weight: 25 },
  D: { label: "Can agents access it programmatically?", weight: 15 },
  E: { label: "Is it robust and efficient?", weight: 15 },
  F: { label: "Is it safe for agents?", weight: 10 },
};

/** A category counts toward the total only once this share of its weight was measured. */
export const MIN_CATEGORY_COVERAGE = 0.25;

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as Category[];

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
