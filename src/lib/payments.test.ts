import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCheckout, findPaidSession, isPaid, paywallEnabled, siteDomain, siteOrigin } from "./payments";

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
  it("charges $9 for the site and returns to its report with the session id", async () => {
    fakeStripe(() => ({ body: { id: "cs_test_a", url: "https://checkout.stripe.com/c/pay/cs_test_a", payment_status: "unpaid" } }));
    const url = await createCheckout("https://www.example.com/", "https://agentready.test");
    assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_a");
    const { form, auth, method } = calls[0];
    assert.equal(method, "POST");
    assert.equal(auth, "Bearer sk_test_123");
    assert.equal(form!.get("line_items[0][price_data][unit_amount]"), "900");
    assert.equal(form!.get("metadata[domain]"), "example.com");
    assert.equal(form!.get("success_url"), "https://agentready.test/report?url=https%3A%2F%2Fwww.example.com%2F&checkout={CHECKOUT_SESSION_ID}");
    assert.equal(form!.get("cancel_url"), "https://agentready.test/report?url=https%3A%2F%2Fwww.example.com%2F");
  });
});

describe("isPaid", () => {
  const session = (over: object) => ({ id: "cs_test_ok", url: null, payment_status: "paid", metadata: { domain: "example.com" }, ...over });

  it("accepts a paid session for the same site", async () => {
    fakeStripe(() => ({ body: session({}) }));
    assert.equal(await isPaid("cs_test_ok", "https://example.com/"), true);
  });

  it("rejects unpaid sessions and sessions for another site", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_unpaid", payment_status: "unpaid" }) }));
    assert.equal(await isPaid("cs_test_unpaid", "https://example.com/"), false);
    fakeStripe(() => ({ body: session({ id: "cs_test_other" }) }));
    assert.equal(await isPaid("cs_test_other", "https://another.com/"), false);
  });

  it("rejects missing, malformed or live session ids without calling Stripe", async () => {
    fakeStripe(() => ({ body: session({}) }));
    for (const id of [undefined, "", "cs_live_abc", "cs_test_../../charges", "nope"]) assert.equal(await isPaid(id, "https://example.com/"), false);
    assert.equal(calls.length, 0);
  });

  it("fails closed when Stripe errors", async () => {
    fakeStripe(() => ({ status: 500, body: { error: { message: "boom" } } }));
    assert.equal(await isPaid("cs_test_err", "https://example.com/"), false);
  });

  it("remembers a verified session so Stripe is called once", async () => {
    fakeStripe(() => ({ body: session({ id: "cs_test_cached" }) }));
    await isPaid("cs_test_cached", "https://example.com/");
    await isPaid("cs_test_cached", "https://www.example.com/");
    assert.equal(calls.length, 1);
  });
});

describe("findPaidSession (Already paid? Restore)", () => {
  const sessions = [
    { id: "cs_test_unpaid", url: null, payment_status: "unpaid", metadata: { domain: "example.com" } },
    { id: "cs_test_other", url: null, payment_status: "paid", metadata: { domain: "another.com" } },
    { id: "cs_test_mine", url: null, payment_status: "paid", metadata: { domain: "example.com" } },
  ];

  it("asks Stripe for completed checkouts by that email and returns the paid one for this site", async () => {
    fakeStripe(() => ({ body: { data: sessions } }));
    assert.equal(await findPaidSession(" Owner@Example.com ", "https://www.example.com/"), "cs_test_mine");
    const q = new URL(calls[0].url).searchParams;
    assert.equal(q.get("customer_details[email]"), "owner@example.com");
    assert.equal(q.get("status"), "complete");
  });

  it("finds nothing for a site this email didn't pay for", async () => {
    fakeStripe(() => ({ body: { data: sessions } }));
    assert.equal(await findPaidSession("owner@example.com", "https://third.com/"), null);
    fakeStripe(() => ({ body: { data: [] } }));
    assert.equal(await findPaidSession("someone@else.com", "https://example.com/"), null);
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

  it("refuses to build a return URL from a non-local Host without SITE_URL", () => {
    assert.throws(() => siteOrigin(spoofed()), /SITE_URL/);
    assert.throws(() => siteOrigin(new Request("http://x/", { headers: { host: "localhost.evil.example" } })), /SITE_URL/);
  });
});
