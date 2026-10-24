import { adminDb } from "../supabase";
import type { Report } from "./types";

const TIMEOUT_MS = 5_000;

/** Store an audit for the leaderboard and score history. Never throws: failures are logged. */
export async function saveAudit(report: Report): Promise<void> {
  // The audits table requires a score; bot-walled or unreachable sites get none under the rubric.
  if (report.error || report.score == null) return;
  try {
    const db = adminDb();
    if (!db) return;
    const domain = new URL(report.url).hostname.replace(/^www\./, "");
    const { name, businessType, city, region, country } = report.business;
    // Only send what was detected, so a re-audit never wipes a type or city with null.
    // Location goes as one unit so an old region can't stick to a new city.
    const row = {
      domain,
      ...(name && { name }),
      ...(businessType && { business_type: businessType }),
      ...(city && { city, region: region ?? null, country: country ?? null }),
    };
    const { data: biz, error: bizError } = await db
      .from("businesses")
      .upsert(row, { onConflict: "domain" })
      .select("id")
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      .single();
    if (bizError) throw new Error(bizError.message);

    const { error } = await db
      .from("audits")
      .insert({
        business_id: biz.id,
        url: report.url,
        score: report.score,
        grade: report.grade,
        // Interim mapping from the A-F rubric to the original three columns (not shown on the
        // leaderboard). Unmeasured categories store 0. Replace once the schema has A-F columns.
        access_score: report.categories.A.score ?? 0,
        understand_score: report.categories.B.score ?? 0,
        act_score: report.categories.C.score ?? 0,
        checks: report.checks,
        audited_at: report.auditedAt,
      })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`[saveAudit] ${report.url} failed:`, err instanceof Error ? err.message : err);
  }
}
