import { runAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return Response.json({ error: "Body must be JSON: { \"url\": \"https://example.com\" }" }, { status: 400 });
  }
  return Response.json(await runAudit(body.url));
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return Response.json({ error: "Pass ?url=https://example.com" }, { status: 400 });
  return Response.json(await runAudit(url));
}
