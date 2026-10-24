import { z } from "zod";
import { FixLinkError, createFixLink } from "@/lib/fix-links";
import { RateLimiter, clientIp } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().url() });

// Each link stores a row and may cost a Context.dev lookup.
const perVisitor = new RateLimiter(20, 60 * 60 * 1000);

/** Creates a shareable fix link (/fix/<slug>) from a site's latest saved audit. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Body must be JSON: { "url": "https://example.com/" }' }, { status: 400 });
  }
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) {
    return Response.json({ error: "Too many fix links created in the last hour. Try again later." }, { status: 429 });
  }
  try {
    const slug = await createFixLink(parsed.data.url);
    return Response.json({ slug, path: `/fix/${slug}` });
  } catch (err) {
    const status = err instanceof FixLinkError ? err.status : 500;
    console.error("[fix-link]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
