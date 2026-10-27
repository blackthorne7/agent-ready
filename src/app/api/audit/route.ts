import { runAudit } from "@/lib/audit";
import { AUDIT_LIMIT_MESSAGE, takeAudit } from "@/lib/limits";

export const dynamic = "force-dynamic";

// Checklist only, and never saved: the leaderboard and fix links use the final score that /api/agent
// saves after the AI agent has tried the site (docs/one-final-score.md), and a partial score saved here
// would replace it as the site's latest audit.

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return Response.json({ error: "Body must be JSON: { \"url\": \"https://example.com\" }" }, { status: 400 });
  }
  if (!takeAudit(req)) return Response.json({ error: AUDIT_LIMIT_MESSAGE }, { status: 429 });
  return Response.json(await runAudit(body.url));
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return Response.json({ error: "Pass ?url=https://example.com" }, { status: 400 });
  if (!takeAudit(req)) return Response.json({ error: AUDIT_LIMIT_MESSAGE }, { status: 429 });
  return Response.json(await runAudit(url));
}
