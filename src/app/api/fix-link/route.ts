import { z } from "zod";
import { FixLinkError, createFixLink } from "@/lib/fix-links";
import { RateLimiter, clientIp } from "@/lib/limits";
import { FIX_LINK_PRICE_LABEL, checkPayment, paywallEnabled } from "@/lib/payments";
import { currentReportFingerprint } from "@/lib/report-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// checkout: the Stripe Checkout Session id that paid for this site's fix link (when the paywall is on).
const Body = z.object({ url: z.string().url(), checkout: z.string().optional() });

// Each link stores a row and may cost a Context.dev lookup.
const perVisitor = new RateLimiter(20, 60 * 60 * 1000);

/** Creates a shareable fix link (/fix/<slug>) from a site's latest saved audit. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Body must be JSON: { "url": "https://example.com/" }' }, { status: 400 });
  }
  // Before the paywall check, so made-up session ids can't trigger unlimited Stripe lookups.
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) {
    return Response.json({ error: "Too many fix links created in the last hour. Try again later." }, { status: 429 });
  }
  // Checked here, not just in the page: the paywall has to hold for direct API calls too.
  // A payment covers one report; a re-check that comes out different needs a new one.
  if (paywallEnabled()) {
    const { url, checkout } = parsed.data;
    const payment = await checkPayment(checkout, url, () => currentReportFingerprint(url));
    if (payment !== "paid") {
      const error =
        payment === "new-report"
          ? `Your site changed since you paid, so this is a new report. Its fix link costs ${FIX_LINK_PRICE_LABEL}.`
          : `The fix link costs ${FIX_LINK_PRICE_LABEL}. Pay first to export it.`;
      return Response.json({ error, paymentRequired: true, newReport: payment === "new-report" }, { status: 402 });
    }
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
