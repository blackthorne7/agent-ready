import { z } from "zod";
import { normalizeUrl, runAudit } from "@/lib/audit";
import { assertPublicUrl } from "@/lib/audit/fetch";
import { saveAudit } from "@/lib/audit/save";
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

  const tasks = await runAgentTasks(url);
  const report = await runAudit(url, { tasks: tasks.map(toTaskRun) });
  // Saved as the site's latest audit, so the leaderboard ranks the score that includes the agent.
  await saveAudit(report);
  return Response.json({ url, tasks, report });
}
