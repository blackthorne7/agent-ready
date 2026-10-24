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

// fresh: the visitor asked to check again (e.g. after making fixes), so skip the cached result.
// blocked: the report page hit a bot wall, so record that for the leaderboard instead of running the agent.
const Body = z.object({ url: z.string().trim().min(1), fresh: z.boolean().optional(), blocked: z.boolean().optional() });

const HOUR = 60 * 60 * 1000;
// Each new run costs three Omnara agent runs and a Context.dev lookup. Repeat visits within the
// hour reuse the result for free; only new runs count against the limits.
const results = new TtlCache<{ url: string; tasks: AgentTaskRun[]; report: Report }>(HOUR, 500);
// Kept apart from `results`, so a site that unblocks us isn't served its old blocked result.
const blockedResults = new TtlCache<Report>(HOUR, 500);
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

  const fresh = parsed.data.fresh === true;
  const cache = parsed.data.blocked ? blockedResults : results;
  if (fresh || !cache.has(url)) {
    const ip = clientIp(req);
    if ((ip && !perVisitor.take(ip)) || !overall.take("all")) {
      return Response.json(
        { error: "Too many new sites checked in the last hour. Try again later; sites checked recently still load." },
        { status: 429 },
      );
    }
  }

  if (parsed.data.blocked) {
    const { value, cached } = await blockedResults.get(url, () => saveBlocked(url), { refresh: fresh });
    return Response.json({ report: value, cached });
  }

  const { value, cached } = await results.get(url, async () => {
    // The brand lookup (industry, location) runs alongside the agent, so it adds no wait.
    const brand = getBrand(new URL(url).hostname.replace(/^www\./, ""));
    // If the agent itself fails, still score and save once without it, so every site gets one final score.
    const tasks = await runAgentTasks(url).catch((err) => {
      console.error("[agent]", err);
      return [];
    });
    const report = await runAudit(url, { tasks: tasks.map(toTaskRun) });
    report.business = applyBrand(report.business, await brand);
    // The only place a report-page audit is saved: once per run, so each check gets one final score.
    await saveAudit(report);
    return { url, tasks, report };
  }, { refresh: fresh });
  return Response.json({ ...value, cached });
}

/**
 * A bot-walled site gets no score, but is saved so the leaderboard can list it as blocked. The
 * server re-checks rather than trusting the page, and skips the agent: the wall turns it away too.
 */
async function saveBlocked(url: string): Promise<Report> {
  const brand = getBrand(new URL(url).hostname.replace(/^www\./, ""));
  const report = await runAudit(url);
  if (report.evaluationStatus !== "blocked_by_site") return report;
  report.business = applyBrand(report.business, await brand);
  await saveAudit(report);
  return report;
}
