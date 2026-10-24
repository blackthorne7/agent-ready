import type { CheerioAPI } from "cheerio";
import type { BlockedAccess } from "./blocked";

/** Agent-friendliness rubric categories (see evals/AGENT_CHECKS.md). */
export type Category = "A" | "B" | "C" | "D" | "E" | "F";

/** How a check is measured. Only "code" and "task" checks can run today. */
export type Method = "code" | "task" | "browser" | "llm";

/** 0 failing · 1 major problems · 2 partial · 3 good · 4 excellent. */
export type Rating = 0 | 1 | 2 | 3 | 4;

/** Display status derived from the rating. "unknown" never affects the score. */
export type Status = "pass" | "warn" | "fail" | "na" | "unknown";

export interface Fetched {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string;
  /** Every URL visited before `url`, in order. */
  redirects: string[];
  /** Raw Set-Cookie headers from the final response. */
  setCookies: string[];
  /** Response headers of the final response, lower-cased names. */
  headers?: Record<string, string>;
  elapsedMs: number;
  error?: string;
}

export type TaskStatus = "success" | "failed" | "blocked" | "error";

/** One agent attempt at a task, produced by lib/agent and fed into task checks. */
export interface TaskRun {
  taskId: string;
  /** Short name, e.g. "Find contact details". */
  title?: string;
  goal: string;
  status: TaskStatus;
  steps: number;
  maxSteps: number;
  reason: string;
  /** The agent's own suggestion for what would have let it succeed. */
  fix?: string;
}

export interface AuditContext {
  url: URL;
  page: Fetched;
  $: CheerioAPI;
  jsonLd: Record<string, unknown>[];
  /** Fetch a path on the audited origin (cached per audit). */
  fetchPath: (path: string) => Promise<Fetched>;
  /** Agent task runs supplied by the caller. Empty when no agent ran. */
  tasks: TaskRun[];
}

export type Outcome =
  | { rating: Rating; detail: string; fix?: string; evidence?: string[] }
  | { rating: "na" | "unknown"; detail: string; evidence?: string[] };

export interface Check {
  id: string;
  category: Category;
  title: string;
  /** Relative weight inside its category. */
  weight: number;
  method: Method;
  /** Set for the cookies/consent/sessions checks so they can be reported together. */
  group?: "cookies";
  /** Omitted for checks we can't measure yet; they are reported as unknown. */
  run?: (ctx: AuditContext) => Promise<Outcome>;
}

export interface CheckResult {
  id: string;
  category: Category;
  title: string;
  weight: number;
  method: Method;
  group?: "cookies";
  rating: Rating | "na" | "unknown";
  status: Status;
  /** rating / 4, or null when not scored. */
  score: number | null;
  detail: string;
  fix?: string;
  evidence?: string[];
}

export interface CategoryScore {
  label: string;
  weight: number;
  /** 0-100 over the checks that ran, or null if none ran. */
  score: number | null;
  /** Share of this category's applicable check weight that was actually measured. */
  coverage: number;
  /** False when too little was measured for the score to count toward the total. */
  countedInTotal: boolean;
}

export interface Diagnostic {
  id: string;
  title: string;
  detail: string;
}

/** Who the site belongs to, read from its JSON-LD. Feeds the leaderboard filters. */
export interface BusinessInfo {
  name?: string;
  /** A business_types slug in supabase/schema.sql, e.g. "restaurant". */
  businessType?: string;
  /** Where businessType came from: the site's own schema.org data, Context.dev, or page keywords. */
  businessTypeSource?: "schema" | "brand" | "keywords";
  city?: string;
  region?: string;
  country?: string;
}

export interface Report {
  url: string;
  auditedAt: string;
  rubricVersion: string;
  /** Blocked or unreachable sites get no score: untested is not the same as bad. */
  evaluationStatus: "evaluated" | "blocked_by_site" | "unreachable";
  /** 0-100 over evaluated categories, or null if nothing could be evaluated. */
  score: number | null;
  grade: string;
  /** Share of applicable rubric weight that was actually measured. Reported separately from score. */
  coverage: number;
  /** Share of agent task runs that succeeded (blocked/error excluded), or null if no tasks ran. */
  taskSuccessRate: number | null;
  categories: Record<Category, CategoryScore>;
  checks: CheckResult[];
  business: BusinessInfo;
  tasks: TaskRun[];
  /** Browser behaviors recorded but not scored. */
  diagnostics: Diagnostic[];
  /** Blocked sites only: who blocked us and what agents can still read. See blocked.ts. */
  access?: BlockedAccess;
  error?: string;
}
