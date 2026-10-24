import { z } from "zod";
import { normalizeUrl, runAudit } from "@/lib/audit";
import { applyBrand } from "@/lib/audit/business";
import { assertPublicUrl } from "@/lib/audit/fetch";
import { saveAudit } from "@/lib/audit/save";
import { getBrand } from "@/lib/context-dev";
import { runAgentTasks, toTaskRun } from "../../../../lib/agent/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().trim().min(1) });

/**
 * Runs the agent tasks (lib/agent/tasks.ts) against a site, then re-scores the site with their
 * results so the rubric's task-based checks count. Takes up to ~2 minutes.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Body must be JSON: { "url": "https://example.com" }' }, { status: 400 });
  }

  const url = normalizeUrl(parsed.data.url);
  try {
    // Reject private or invalid hosts before launching any agents.
    await assertPublicUrl(url);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  // The brand lookup (industry, location) runs alongside the agent, so it adds no wait.
  const brand = getBrand(new URL(url).hostname.replace(/^www\./, ""));
  // If the agent itself fails, still score and save once without it, so every site gets one final score.
  const tasks = await runAgentTasks(url).catch((err) => {
    console.error("[agent]", err);
    return [];
  });
  const report = await runAudit(url, { tasks: tasks.map(toTaskRun) });
  report.business = applyBrand(report.business, await brand);
  // The only place a report-page audit is saved, so each check gets one final score.
  await saveAudit(report);
  return Response.json({ url, tasks, report });
}
