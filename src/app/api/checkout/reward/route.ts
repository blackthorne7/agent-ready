import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/limits";
import { PaymentError, paywallEnabled, rewardFor } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ checkout: z.string() });

const perVisitor = new RateLimiter(30, 60 * 60 * 1000);

/** The buyer's free-next-report code for a paid checkout: { code, expiresAt, active }, or 404 if it doesn't earn one. */
export async function POST(req: Request) {
  if (!paywallEnabled()) return Response.json({ error: "Payments aren't set up." }, { status: 409 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Body must be JSON: { "checkout": "cs_test_..." }' }, { status: 400 });
  const ip = clientIp(req);
  if (ip && !perVisitor.take(ip)) return Response.json({ error: "Too many requests in the last hour. Try again later." }, { status: 429 });
  try {
    const reward = await rewardFor(parsed.data.checkout);
    if (!reward) return Response.json({ error: "This checkout doesn't come with a free-next-report code." }, { status: 404 });
    return Response.json(reward);
  } catch (err) {
    console.error("[checkout/reward]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof PaymentError ? err.status : 500 });
  }
}
