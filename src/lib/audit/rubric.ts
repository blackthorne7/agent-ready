import type { Category } from "./types";

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
