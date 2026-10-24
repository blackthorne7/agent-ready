// Stripe Checkout for the fix link: the report is free, exporting a site's fixes to an AI agent costs FIX_LINK_PRICE_CENTS.
// Calls Stripe's REST API directly (no SDK). Test mode only: a live key is refused, so this demo can't take real money.
// Env: STRIPE_SECRET_KEY (sk_test_...). Unset = no paywall, fix links stay free.

import { FIX_LINK_PRICE_CENTS } from "./pricing";

export { FIX_LINK_PRICE_CENTS, FIX_LINK_PRICE_LABEL } from "./pricing";

const STRIPE_API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 10_000;

function secretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    console.error("[payments] STRIPE_SECRET_KEY is not a test key; refusing to take real payments. Paywall is off.");
    return null;
  }
  return key;
}

/** True when exporting a fix link requires payment. */
export function paywallEnabled(): boolean {
  return secretKey() != null;
}

/** Hostname without "www.", so a payment for www.example.com also covers example.com. */
export function siteDomain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function stripe<T>(path: string, init: { method: "GET" | "POST"; form?: Record<string, string> }): Promise<T> {
  const key = secretKey();
  if (!key) throw new PaymentError("Payments aren't set up.", 503);
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${key}`, ...(init.form && { "content-type": "application/x-www-form-urlencoded" }) },
    body: init.form && new URLSearchParams(init.form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stripe's message, not the key or request.
    throw new PaymentError(body?.error?.message ?? `Stripe request failed (${res.status})`, res.status >= 500 ? 502 : 400);
  }
  return body as T;
}

interface CheckoutSession {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  metadata: Record<string, string> | null;
}

/** A Stripe Checkout page for one site's fix link. Returns to the report with ?checkout=<session id>. */
export async function createCheckout(siteUrl: string, origin: string): Promise<string> {
  const domain = siteDomain(siteUrl);
  const report = `${origin}/report?url=${encodeURIComponent(siteUrl)}`;
  const session = await stripe<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    form: {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(FIX_LINK_PRICE_CENTS),
      "line_items[0][price_data][product_data][name]": `Fix link for ${domain}`,
      "line_items[0][price_data][product_data][description]": "Every fix for this website in one link, ready to paste into your AI website builder.",
      "metadata[domain]": domain,
      // Stripe fills in {CHECKOUT_SESSION_ID}; it must stay unencoded.
      success_url: `${report}&checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: report,
    },
  });
  if (!session.url) throw new PaymentError("Stripe didn't return a checkout page.", 502);
  return session.url;
}

// Paid sessions never become unpaid, so verified ones are remembered for the life of the process.
const verified = new Map<string, string>();

/** True if `sessionId` is a paid Checkout Session for this site's domain. */
export async function isPaid(sessionId: string | undefined, siteUrl: string): Promise<boolean> {
  if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return false;
  const domain = siteDomain(siteUrl);
  if (verified.get(sessionId) === domain) return true;
  try {
    const session = await stripe<CheckoutSession>(`/checkout/sessions/${sessionId}`, { method: "GET" });
    if (session.payment_status !== "paid" || session.metadata?.domain !== domain) return false;
    verified.set(sessionId, domain);
    return true;
  } catch (err) {
    console.error("[payments] verify failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** This request's public origin (the site runs behind a TLS proxy). */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
