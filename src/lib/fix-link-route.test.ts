import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { POST } from "../app/api/fix-link/route";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("/api/fix-link", () => {
  it("rate-limits before asking Stripe, so random session ids can't cause unlimited lookups", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    let stripeCalls = 0;
    globalThis.fetch = (async () => {
      stripeCalls++;
      return new Response(JSON.stringify({ payment_status: "unpaid", metadata: {} }), { status: 200 });
    }) as typeof fetch;

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const req = new Request("http://localhost/api/fix-link", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ url: "https://example.com/", checkout: `cs_test_random${i}` }),
      });
      statuses.push((await POST(req)).status);
    }
    assert.deepEqual([...new Set(statuses)], [402, 429]);
    assert.equal(stripeCalls, 20, "one Stripe lookup per allowed request, none after the limit");
  });
});

describe("/api/checkout/restore", () => {
  const restore = async (body: object, ip = "198.51.100.9") => {
    const { POST: restorePOST } = await import("../app/api/checkout/restore/route");
    return restorePOST(
      new Request("http://localhost/api/checkout/restore", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );
  };

  it("unlocks only with the email that paid for this site, with one answer for every miss", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const email = new URL(String(input)).searchParams.get("customer_details[email]");
      const data = email === "owner@example.com" ? [{ id: "cs_test_paid1", payment_status: "paid", metadata: { domain: "example.com" } }] : [];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;

    const ok = await restore({ url: "https://example.com/", email: "owner@example.com" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { checkout: "cs_test_paid1" });

    const wrongEmail = await restore({ url: "https://example.com/", email: "stranger@example.com" });
    const wrongSite = await restore({ url: "https://another.com/", email: "owner@example.com" });
    assert.equal(wrongEmail.status, 404);
    assert.equal(wrongSite.status, 404);
    assert.deepEqual(await wrongEmail.json(), await wrongSite.json());

    assert.equal((await restore({ url: "https://example.com/", email: "not-an-email" })).status, 400);
  });

  it("limits tries per visitor so emails can't be guessed in bulk", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await restore({ url: "https://example.com/", email: `guess${i}@example.com` }, "192.0.2.44")).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404));
    assert.deepEqual(statuses.slice(10), [429, 429]);
  });
});
