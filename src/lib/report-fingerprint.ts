// A fingerprint of a report, so a fix-link payment covers one report: re-checking an unchanged site
// gives the same fingerprint (no new charge); changing anything the page checks look at gives a new one.

import { createHash } from "node:crypto";
import { runAudit } from "./audit";
import { PaymentError } from "./payments";
import type { CheckResult } from "./audit/types";
import { adminDb } from "./supabase";

// Results that vary between runs of an unchanged site, so they'd charge people for nothing.
const VOLATILE_CHECKS = new Set(["response-time"]);

/**
 * SHA-256 of the page checks that still need fixing (id and rating), in a fixed order: the part of the
 * report the fix link sells. Fixing something, or moving its rating, changes it; nothing else does.
 *
 * Left out, because they vary on an unchanged site: checks with nothing to fix (big sites A/B-test pages,
 * so a check can flip between "good" and "doesn't apply"), the exact evidence (which elements, which order),
 * load time, and the AI agent's task checks. Tested stable over 5 runs each on stripe.com, gov.uk,
 * python.org, djangoproject.com and wikipedia.org.
 */
export function fingerprintChecks(checks: CheckResult[]): string {
  const stable = checks
    .filter((c) => c.method === "code" && !VOLATILE_CHECKS.has(c.id) && (c.status === "fail" || c.status === "warn"))
    .map((c) => [c.id, c.rating] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
}

/**
 * The fingerprint of the report the visitor is looking at: the latest saved audit of `siteUrl`.
 * Without Supabase (local dev) there's no saved audit, so a fresh page check stands in for it.
 */
export async function currentReportFingerprint(siteUrl: string): Promise<string> {
  const db = adminDb();
  if (!db) return fingerprintChecks((await runAudit(siteUrl)).checks);
  const { data, error } = await db.from("audits").select("checks").eq("url", siteUrl).order("audited_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PaymentError("No saved report for this site yet. Run the check first.", 404);
  return fingerprintChecks(data.checks as CheckResult[]);
}
