import { z } from "zod";
import { normalizeUrl } from "@/lib/audit";
import { assertPublicUrl } from "@/lib/audit/fetch";
import { runAgentTasks } from "../../../../lib/agent/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().trim().min(1) });

/** Runs the agent tasks (lib/agent/tasks.ts) against a site. Takes up to ~2 minutes. */
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
  return Response.json({ url, tasks });
}
