import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/limits";
import { PaymentError, findPaidSession, paywallEnabled } from "@/lib/payments";
import { currentReportFingerprint } from "@/lib/report-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ url: z.string().url(), email: z.string().email().max(254) });

// Low, so emails can't be tried in bulk to find who bought what.
const perVisitor = new RateLimiter(10, 60 * 60 * 1000);

/** "Already paid?": finds the visitor's paid checkout for this site's current report by the email they used. Returns { checkout }. */
export async function POST(req: Request) {
  if (!paywallEnabled()) return Response.json({ error: "Payments aren't set up, so fix links are free." }, { status: 409 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the email you used at checkout." }, { status: 400 });
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) return Response.json({ error: "Too many tries in the last hour. Try again later." }, { status: 429 });
  try {
    const report = await currentReportFingerprint(parsed.data.url);
    const checkout = await findPaidSession(parsed.data.email, parsed.data.url, report);
    // One answer for every miss (unknown email, other site, earlier report), so it doesn't reveal who bought what.
    if (!checkout) {
      return Response.json(
        { error: "No payment for this report was found with that email. If you paid before changing your site, the new report needs a new payment." },
        { status: 404 },
      );
    }
    return Response.json({ checkout });
  } catch (err) {
    console.error("[checkout/restore]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof PaymentError ? err.status : 500 });
  }
}
