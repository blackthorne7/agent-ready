import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/limits";
import { PaymentError, createCheckout, paywallEnabled, siteOrigin } from "@/lib/payments";
import { currentReportFingerprint } from "@/lib/report-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().url() });

const perVisitor = new RateLimiter(20, 60 * 60 * 1000);

/** Starts Stripe Checkout for one site's fix link. Returns { checkoutUrl } to send the browser to. */
export async function POST(req: Request) {
  if (!paywallEnabled()) return Response.json({ error: "Payments aren't set up, so fix links are free." }, { status: 409 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Body must be JSON: { "url": "https://example.com/" }' }, { status: 400 });
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) return Response.json({ error: "Too many checkout attempts in the last hour. Try again later." }, { status: 429 });
  try {
    const origin = siteOrigin(req);
    // The payment covers the report the visitor is looking at.
    const report = await currentReportFingerprint(parsed.data.url);
    return Response.json({ checkoutUrl: await createCheckout(parsed.data.url, origin, report) });
  } catch (err) {
    console.error("[checkout]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof PaymentError ? err.status : 500 });
  }
}
