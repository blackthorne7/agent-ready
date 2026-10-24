import type { CheerioAPI } from "cheerio";

export type Category = "access" | "understand" | "act";
export type Status = "pass" | "warn" | "fail";

export interface Fetched {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string;
  error?: string;
}

export interface AuditContext {
  url: URL;
  page: Fetched;
  $: CheerioAPI;
  jsonLd: Record<string, unknown>[];
  /** Fetch a path on the audited origin (cached per audit). */
  fetchPath: (path: string) => Promise<Fetched>;
}

export interface CheckResult {
  id: string;
  category: Category;
  title: string;
  status: Status;
  /** 0..1 */
  score: number;
  weight: number;
  detail: string;
  fix?: string;
}

export interface Check {
  id: string;
  category: Category;
  title: string;
  weight: number;
  run: (ctx: AuditContext) => Promise<Omit<CheckResult, "id" | "category" | "title" | "weight">>;
}

export interface Report {
  url: string;
  auditedAt: string;
  score: number;
  grade: string;
  categories: Record<Category, { score: number; label: string }>;
  checks: CheckResult[];
  error?: string;
}
