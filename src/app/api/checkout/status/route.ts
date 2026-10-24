import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/limits";
import { checkPayment, paywallEnabled } from "@/lib/payments";
import { currentReportFingerprint } from "@/lib/report-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().url(), checkout: z.string() });

const perVisitor = new RateLimiter(30, 60 * 60 * 1000);

/** Whether a stored payment still covers this site's current report: { status: "paid" | "new-report" | "unpaid" }. */
export async function POST(req: Request) {
  if (!paywallEnabled()) return Response.json({ status: "paid" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Body must be JSON: { "url": "...", "checkout": "cs_test_..." }' }, { status: 400 });
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) return Response.json({ error: "Too many requests in the last hour. Try again later." }, { status: 429 });
  const { url, checkout } = parsed.data;
  return Response.json({ status: await checkPayment(checkout, url, () => currentReportFingerprint(url)) });
}
