import { z } from "zod";
import { normalizeUrl, runAudit, type Report } from "@/lib/audit";
import { applyBrand } from "@/lib/audit/business";
import { assertPublicUrl } from "@/lib/audit/fetch";
import { saveAudit } from "@/lib/audit/save";
import { getBrand } from "@/lib/context-dev";
import { RateLimiter, TtlCache, clientIp } from "@/lib/limits";
import { runAgentTasks, toTaskRun, type AgentTaskRun } from "../../../../lib/agent/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().trim().min(1) });

const HOUR = 60 * 60 * 1000;
// Each new run costs three Omnara agent runs and a Context.dev lookup. Repeat visits within the
// hour reuse the result for free; only new runs count against the limits.
const results = new TtlCache<{ url: string; tasks: AgentTaskRun[]; report: Report }>(HOUR, 500);
const perVisitor = new RateLimiter(6, HOUR);
const overall = new RateLimiter(120, HOUR);

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

  if (!results.has(url)) {
    const ip = clientIp(req);
    if ((ip && !perVisitor.take(ip)) || !overall.take("all")) {
      return Response.json(
        { error: "Too many new sites checked in the last hour. Try again later; sites checked recently still load." },
        { status: 429 },
      );
    }
  }

  const { value, cached } = await results.get(url, async () => {
    // The brand lookup (industry, location) runs alongside the agent, so it adds no wait.
    const brand = getBrand(new URL(url).hostname.replace(/^www\./, ""));
    const tasks = await runAgentTasks(url);
    const report = await runAudit(url, { tasks: tasks.map(toTaskRun) });
    report.business = applyBrand(report.business, await brand);
    // Saved once per run, as the site's latest audit, so the leaderboard ranks the score that includes the agent.
    await saveAudit(report);
    return { url, tasks, report };
  });
  return Response.json({ ...value, cached });
}
