import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DEFAULT_SITE_URL, checkPayment, createCheckout, customerOf, findPaidSession, paywallEnabled, rewardFor, siteDomain, siteOrigin } from "./payments";

type Call = { url: string; method: string; form: URLSearchParams | null; auth: string | null };

const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Stands in for Stripe: records requests and answers with `reply`. */
function fakeStripe(reply: (c: Call) => { status?: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      form: init?.body ? new URLSearchParams(String(init.body)) : null,
      auth: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    const { status = 200, body } = reply(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SITE_URL;
});

describe("paywall", () => {
  it("is on only with a test key", () => {
    assert.equal(paywallEnabled(), true);
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    assert.equal(paywallEnabled(), false, "a live key must never turn on real charging");
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(paywallEnabled(), false);
  });

  it("treats www and bare hosts as one site", () => {
    assert.equal(siteDomain("https://www.Example.com/menu"), "example.com");
  });
});

describe("checkout", () => {
  it("charges $9 for this report and returns to it with the session id", async () => {
    fakeStripe(() => ({ body: { id: "cs_test_a", url: "https://checkout.stripe.com/c/pay/cs_test_a", payment_status: "unpaid" } }));
    const url = await createCheckout("https://www.example.com/", "https://agentready.test", "report-fp-1");
    assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_a");
    const { form, auth, method } = calls[0];
    assert.equal(method, "POST");
    assert.equal(auth, "Bearer sk_test_123");
    assert.equal(form!.get("line_items[0][price_data][unit_amount]"), "900");
    assert.equal(form!.get("metadata[domain]"), "example.com");
    assert.equal(form!.get("metadata[report]"), "report-fp-1");
    assert.equal(form!.get("allow_promotion_codes"), "true");
    assert.equal(form!.get("success_url"), "https://agentready.test/report?url=https%3A%2F%2Fwww.example.com%2F&checkout={CHECKOUT_SESSION_ID}");
    assert.equal(form!.get("cancel_url"), "https://agentready.test/report?url=https%3A%2F%2Fwww.example.com%2F");
  });
});

describe("checkPayment", () => {
  const session = (over: object) => ({ id: "cs_test_ok", url: null, payment_status: "paid", metadata: { domain: "example.com", report: "fp-A" }, ...over });
  const report = (fp: string) => async () => fp;

  it("is paid for the same site and the same report", async () => {
    fakeStripe(() => ({ body: session({}) }));
    assert.equal(await checkPayment("cs_test_ok", "https://example.com/", report("fp-A")), "paid");
  });

  it("accepts a checkout completed at $0 with a 100%-off promotion code, but not an abandoned one", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_promo", status: "complete", payment_status: "no_payment_required" }) }));
    assert.equal(await checkPayment("cs_test_promo", "https://example.com/", report("fp-A")), "paid");
    fakeStripe(() => ({ body: session({ id: "cs_test_promo_open", status: "open", payment_status: "no_payment_required" }) }));
    assert.equal(await checkPayment("cs_test_promo_open", "https://example.com/", report("fp-A")), "unpaid");
  });

  it("asks for a new payment when the site changed since (different report)", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_changed" }) }));
    assert.equal(await checkPayment("cs_test_changed", "https://example.com/", report("fp-B")), "new-report");
  });

  it("rejects unpaid sessions, other sites, and sessions without a report", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_unpaid", payment_status: "unpaid" }) }));
    assert.equal(await checkPayment("cs_test_unpaid", "https://example.com/", report("fp-A")), "unpaid");
    fakeStripe(() => ({ body: session({ id: "cs_test_other" }) }));
    assert.equal(await checkPayment("cs_test_other", "https://another.com/", report("fp-A")), "unpaid");
    fakeStripe(() => ({ body: session({ id: "cs_test_noreport", metadata: { domain: "example.com" } }) }));
    assert.equal(await checkPayment("cs_test_noreport", "https://example.com/", report("fp-A")), "unpaid");
  });

  it("only works out the report fingerprint once the session itself checks out", async () => {
    let computed = 0;
    const counting = async () => (computed++, "fp-A");
    fakeStripe(() => ({ body: session({ id: "cs_test_unpaid2", payment_status: "unpaid" }) }));
    await checkPayment("cs_test_unpaid2", "https://example.com/", counting);
    assert.equal(computed, 0);
  });

  it("rejects missing, malformed or live session ids without calling Stripe", async () => {
    fakeStripe(() => ({ body: session({}) }));
    for (const id of [undefined, "", "cs_live_abc", "cs_test_../../charges", "nope"]) {
      assert.equal(await checkPayment(id, "https://example.com/", report("fp-A")), "unpaid");
    }
    assert.equal(calls.length, 0);
  });

  it("fails closed when Stripe errors", async () => {
    fakeStripe(() => ({ status: 500, body: { error: { message: "boom" } } }));
    assert.equal(await checkPayment("cs_test_err", "https://example.com/", report("fp-A")), "unpaid");
  });

  it("remembers a verified session so Stripe is called once", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_cached" }) }));
    await checkPayment("cs_test_cached", "https://example.com/", report("fp-A"));
    assert.equal(await checkPayment("cs_test_cached", "https://www.example.com/", report("fp-A")), "paid");
    assert.equal(calls.length, 1);
  });
});

describe("findPaidSession (Already paid? Restore)", () => {
  const sessions = [
    { id: "cs_test_unpaid", url: null, payment_status: "unpaid", metadata: { domain: "example.com", report: "fp-A" } },
    { id: "cs_test_other", url: null, payment_status: "paid", metadata: { domain: "another.com", report: "fp-A" } },
    { id: "cs_test_old", url: null, payment_status: "paid", metadata: { domain: "example.com", report: "fp-OLD" } },
    { id: "cs_test_mine", url: null, payment_status: "paid", metadata: { domain: "example.com", report: "fp-A" } },
  ];

  it("asks Stripe for completed checkouts by that email and returns the paid one for this report", async () => {
    fakeStripe(() => ({ body: { data: sessions } }));
    assert.equal(await findPaidSession(" Owner@Example.com ", "https://www.example.com/", "fp-A"), "cs_test_mine");
    const q = new URL(calls[0].url).searchParams;
    assert.equal(q.get("customer_details[email]"), "owner@example.com");
    assert.equal(q.get("status"), "complete");
  });

  it("finds nothing for another site, another report, or another email", async () => {
    fakeStripe(() => ({ body: { data: sessions } }));
    assert.equal(await findPaidSession("owner@example.com", "https://third.com/", "fp-A"), null);
    assert.equal(await findPaidSession("owner@example.com", "https://example.com/", "fp-NEW"), null);
    fakeStripe(() => ({ body: { data: [] } }));
    assert.equal(await findPaidSession("someone@else.com", "https://example.com/", "fp-A"), null);
  });
});

describe("returning buyer's customer", () => {
  it("a first checkout creates a customer; a returning buyer's reuses theirs", async () => {
    fakeStripe(() => ({ body: { id: "cs_test_n", url: "https://checkout.stripe.com/x" } }));
    await createCheckout("https://example.com/", "https://agentready.test", "fp");
    assert.equal(calls[0].form!.get("customer_creation"), "always");
    assert.equal(calls[0].form!.get("customer"), null);
    await createCheckout("https://example.com/", "https://agentready.test", "fp", "cus_123");
    assert.equal(calls[1].form!.get("customer"), "cus_123");
    assert.equal(calls[1].form!.get("customer_creation"), null);
  });

  it("takes the customer only from a settled checkout in Stripe", async () => {
    fakeStripe(() => ({ body: { id: "cs_test_c", payment_status: "paid", customer: "cus_123", metadata: {} } }));
    assert.equal(await customerOf("cs_test_c"), "cus_123");
    fakeStripe(() => ({ body: { id: "cs_test_u", payment_status: "unpaid", customer: "cus_999", metadata: {} } }));
    assert.equal(await customerOf("cs_test_u"), null);
    assert.equal(await customerOf("cus_123"), null, "a raw customer id from the client is never accepted");
    assert.equal(await customerOf(undefined), null);
  });
});

describe("rewardFor (free next report)", () => {
  const paid = { id: "cs_test_buy1", payment_status: "paid", status: "complete", amount_total: 900, customer: "cus_buyer", metadata: {} };

  it("creates a single-use, buyer-only, 30-day 100%-off code for a paid purchase", async () => {
    fakeStripe((c) => {
      if (c.url.includes("/promotion_codes?")) return { body: { data: [] } };
      if (c.url.includes("/checkout/sessions/")) return { body: paid };
      if (c.url.endsWith("/coupons")) return { body: { id: c.form!.get("id") } };
      return { body: { code: c.form!.get("code"), active: true, expires_at: Number(c.form!.get("expires_at")) } };
    });
    const before = Date.now();
    const reward = await rewardFor("cs_test_buy1");
    assert.ok(reward && /^FREE[0-9A-F]{8}$/.test(reward.code) && reward.active);

    const coupon = calls.find((c) => c.url.endsWith("/coupons"))!.form!;
    assert.equal(coupon.get("percent_off"), "100");
    assert.equal(coupon.get("duration"), "once");
    assert.equal(coupon.get("max_redemptions"), "1");
    const promo = calls.find((c) => c.url.endsWith("/promotion_codes") && c.method === "POST")!.form!;
    assert.equal(promo.get("promotion[type]"), "coupon");
    assert.equal(promo.get("promotion[coupon]"), coupon.get("id"));
    assert.equal(promo.get("customer"), "cus_buyer");
    assert.equal(promo.get("max_redemptions"), "1");
    const days = (Number(promo.get("expires_at")) * 1000 - before) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `expires in ${days} days`);
  });

  it("returns the same code again instead of making a second one", async () => {
    fakeStripe(() => ({ body: { data: [{ code: "FREEABCD1234", active: false, expires_at: 2_000_000_000 }] } }));
    const reward = await rewardFor("cs_test_buy1");
    assert.equal(reward?.code, "FREEABCD1234");
    assert.equal(reward?.active, false, "a used code shows as used");
    assert.ok(calls.every((c) => c.method === "GET"), "nothing created");
  });

  it("gives no code for a checkout completed at $0 (paid with a free code), unpaid, or without a customer", async () => {
    for (const session of [
      { ...paid, payment_status: "no_payment_required", amount_total: 0 },
      { ...paid, payment_status: "unpaid" },
      { ...paid, customer: null },
    ]) {
      fakeStripe((c) => (c.url.includes("/promotion_codes?") ? { body: { data: [] } } : { body: session }));
      assert.equal(await rewardFor("cs_test_buy1"), null);
      assert.ok(calls.every((c) => c.method === "GET"), "nothing created");
    }
  });
});

describe("siteOrigin", () => {
  const spoofed = () =>
    new Request("http://0.0.0.0:3000/api/checkout", { headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } });

  it("uses SITE_URL and ignores Host headers the client can set", () => {
    process.env.SITE_URL = "https://agentready.app/some/path";
    assert.equal(siteOrigin(spoofed()), "https://agentready.app");
  });

  it("falls back to the Host header only on localhost", () => {
    assert.equal(siteOrigin(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } })), "http://localhost:3000");
    assert.equal(siteOrigin(new Request("http://127.0.0.1:3000/x", { headers: { host: "127.0.0.1:3000" } })), "http://127.0.0.1:3000");
  });

  it("never uses a non-local Host: without SITE_URL it returns to the live site", () => {
    assert.equal(siteOrigin(spoofed()), DEFAULT_SITE_URL);
    assert.equal(siteOrigin(new Request("http://x/", { headers: { host: "localhost.evil.example" } })), DEFAULT_SITE_URL);
  });
});
