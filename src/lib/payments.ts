// Stripe Checkout for the fix link: the report is free, exporting a site's fixes to an AI agent costs FIX_LINK_PRICE_CENTS.
// Calls Stripe's REST API directly (no SDK). Test mode only: a live key is refused, so this demo can't take real money.
// Env: STRIPE_SECRET_KEY (sk_test_...). Unset = no paywall, fix links stay free.
//      SITE_URL: where Stripe sends the payer back. Defaults to the live site (DEFAULT_SITE_URL); localhost uses itself.

import { createHash } from "node:crypto";
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
    /** Stripe's error code, e.g. "resource_already_exists". */
    readonly stripeCode?: string,
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
    throw new PaymentError(body?.error?.message ?? `Stripe request failed (${res.status})`, res.status >= 500 ? 502 : 400, body?.error?.code);
  }
  return body as T;
}

interface CheckoutSession {
  id: string;
  url: string | null;
  status?: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  metadata: Record<string, string> | null;
  /** The Stripe customer the checkout belongs to (checkouts create or reuse one). */
  customer?: string | null;
  /** What was charged, in cents, after discounts. 0 when a 100%-off code was used. */
  amount_total?: number | null;
}

/**
 * A Stripe Checkout page for one report's fix link: `report` is the report's fingerprint
 * (src/lib/report-fingerprint.ts), so the payment covers that report and re-checks that come out the same.
 * Returns to the report with ?checkout=<session id>.
 */
export async function createCheckout(siteUrl: string, origin: string, report: string, customer?: string | null): Promise<string> {
  const domain = siteDomain(siteUrl);
  const back = `${origin}/report?url=${encodeURIComponent(siteUrl)}`;
  const session = await stripe<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    form: {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(FIX_LINK_PRICE_CENTS),
      "line_items[0][price_data][product_data][name]": `Fix link for ${domain}`,
      "line_items[0][price_data][product_data][description]": "Every fix from this report in one link, ready to paste into your AI website builder.",
      "metadata[domain]": domain,
      "metadata[report]": report,
      // A returning buyer keeps their Stripe customer, so their free-next-report code (buyer only) applies.
      ...(customer ? { customer } : { customer_creation: "always" }),
      // Promotion codes (created in the Stripe dashboard) can be entered on the checkout page.
      allow_promotion_codes: "true",
      // Stripe fills in {CHECKOUT_SESSION_ID}; it must stay unencoded.
      success_url: `${back}&checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: back,
    },
  });
  if (!session.url) throw new PaymentError("Stripe didn't return a checkout page.", 502);
  return session.url;
}

/** Paid in full, or completed at $0 with a 100%-off promotion code (Stripe reports that as no_payment_required). */
function settled(s: CheckoutSession): boolean {
  return s.payment_status === "paid" || (s.payment_status === "no_payment_required" && s.status === "complete");
}

// Paid sessions never become unpaid, so their domain and report are remembered for the life of the process.
const verified = new Map<string, { domain: string; report: string }>();

/**
 * "paid": a paid Checkout Session for this site and for the report the visitor is on now.
 * "new-report": paid for this site, but for an earlier report (the site changed since), so it needs a new payment.
 * "unpaid": anything else, including Stripe errors (fails closed).
 * `currentReport` gives the current report's fingerprint; it's only computed once the session itself checks out,
 * so made-up session ids cost one Stripe lookup and nothing more.
 */
export async function checkPayment(
  sessionId: string | undefined,
  siteUrl: string,
  currentReport: () => Promise<string>,
): Promise<"paid" | "new-report" | "unpaid"> {
  if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return "unpaid";
  const domain = siteDomain(siteUrl);
  try {
    let paid = verified.get(sessionId);
    if (!paid) {
      const session = await stripe<CheckoutSession>(`/checkout/sessions/${sessionId}`, { method: "GET" });
      if (!settled(session) || !session.metadata?.domain || !session.metadata.report) return "unpaid";
      paid = { domain: session.metadata.domain, report: session.metadata.report };
      verified.set(sessionId, paid);
    }
    if (paid.domain !== domain) return "unpaid";
    return paid.report === (await currentReport()) ? "paid" : "new-report";
  } catch (err) {
    console.error("[payments] verify failed:", err instanceof Error ? err.message : err);
    return "unpaid";
  }
}

interface SessionList {
  data: CheckoutSession[];
}

/**
 * "Already paid?": the paid Checkout Session for this site and report bought with `email`, or null.
 * Lets a buyer unlock again after clearing storage or on another device, without unlocking the site for everyone.
 * Proves knowledge of the checkout email, not ownership of the inbox; an emailed one-time code would.
 */
export async function findPaidSession(email: string, siteUrl: string, report: string): Promise<string | null> {
  const domain = siteDomain(siteUrl);
  const params = new URLSearchParams({ "customer_details[email]": email.trim().toLowerCase(), status: "complete", limit: "100" });
  const { data } = await stripe<SessionList>(`/checkout/sessions?${params}`, { method: "GET" });
  const session = data.find((s) => settled(s) && s.metadata?.domain === domain && s.metadata?.report === report);
  if (!session) return null;
  verified.set(session.id, { domain, report });
  return session.id;
}

/** The live site's permanent address (README "Deploy": the URL never changes). */
export const DEFAULT_SITE_URL = "https://agentready.sfo.unikraft.app";

/** A settled checkout's Stripe customer, so the buyer's next checkout reuses it. Null for anything else. */
export async function customerOf(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return null;
  try {
    const session = await stripe<CheckoutSession>(`/checkout/sessions/${sessionId}`, { method: "GET" });
    return settled(session) ? (session.customer ?? null) : null;
  } catch {
    return null;
  }
}

export interface Reward {
  code: string;
  /** ISO date the code stops working. */
  expiresAt: string;
  /** False once it's been used (or expired). */
  active: boolean;
}

const REWARD_DAYS = 30;

interface PromotionCode {
  code: string;
  active: boolean;
  expires_at: number | null;
}

const toReward = (p: PromotionCode): Reward => ({ code: p.code, active: p.active, expiresAt: new Date((p.expires_at ?? 0) * 1000).toISOString() });

async function findPromotionCode(code: string): Promise<PromotionCode | null> {
  const { data } = await stripe<{ data: PromotionCode[] }>(`/promotion_codes?${new URLSearchParams({ code, limit: "1" })}`, { method: "GET" });
  return data[0] ?? null;
}

/**
 * The thank-you code for a purchase: 100% off the buyer's next report, single use, only for the buyer's
 * Stripe customer, valid 30 days. Created the first time it's asked for and the same code after that
 * (its id and code come from the session id). Null unless the checkout actually charged money, so a
 * free report paid with one of these codes doesn't earn another.
 */
export async function rewardFor(sessionId: string): Promise<Reward | null> {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const tag = createHash("sha256").update(sessionId).digest("hex").slice(0, 10);
  const code = `FREE${tag.slice(0, 8).toUpperCase()}`;
  // Already made: return it, with Stripe's current used/expired state.
  const existing = await findPromotionCode(code);
  if (existing) return toReward(existing);

  const session = await stripe<CheckoutSession>(`/checkout/sessions/${sessionId}`, { method: "GET" });
  if (session.payment_status !== "paid" || !session.amount_total || !session.customer) return null;

  const expires = Math.floor(Date.now() / 1000) + REWARD_DAYS * 24 * 60 * 60;
  const couponId = `free-next-report-${tag}`;
  try {
    await stripe("/coupons", {
      method: "POST",
      form: {
        id: couponId,
        name: "Free next report",
        percent_off: "100",
        duration: "once",
        max_redemptions: "1",
        redeem_by: String(expires),
        "metadata[session]": session.id,
      },
    });
  } catch (err) {
    if (!(err instanceof PaymentError && err.stripeCode === "resource_already_exists")) throw err;
  }
  try {
    const promo = await stripe<PromotionCode>("/promotion_codes", {
      method: "POST",
      form: {
        "promotion[type]": "coupon",
        "promotion[coupon]": couponId,
        code,
        customer: session.customer,
        max_redemptions: "1",
        expires_at: String(expires),
        "metadata[session]": session.id,
      },
    });
    return toReward(promo);
  } catch (err) {
    // Created by a concurrent request in the meantime.
    const raced = await findPromotionCode(code);
    if (raced) return toReward(raced);
    throw err;
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Where Stripe returns the payer: SITE_URL, never the request's Host header, which a client can set.
 * Otherwise a checkout could send the payer, and their paid session id, to another domain.
 * Without SITE_URL: localhost for `pnpm dev`, else the live site, so a deploy that lacks it still works.
 */
export function siteOrigin(req: Request): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      throw new PaymentError("SITE_URL isn't a valid URL.", 503);
    }
  }
  const host = req.headers.get("host") ?? new URL(req.url).host;
  if (LOCAL_HOST.test(host)) return `http://${host}`;
  return DEFAULT_SITE_URL;
}
