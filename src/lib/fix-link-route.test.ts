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

  it("unlocks only with the email that paid for this site's current report, with one answer for every miss", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    // Stripe answers by email; every other fetch is the audited site (one fixed page, so its report is stable).
    let paidReport = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.stripe.com") return new Response("<html><head><title>Shop</title></head><body><h1>Shop</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
      const email = url.searchParams.get("customer_details[email]");
      const data =
        email === "owner@example.com"
          ? [{ id: "cs_test_paid1", payment_status: "paid", metadata: { domain: "example.com", report: paidReport } }]
          : email === "early@example.com"
            ? [{ id: "cs_test_early", payment_status: "paid", metadata: { domain: "example.com", report: "an-earlier-report" } }]
            : [];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;
    const { currentReportFingerprint } = await import("./report-fingerprint");
    paidReport = await currentReportFingerprint("https://example.com/");

    const ok = await restore({ url: "https://example.com/", email: "owner@example.com" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { checkout: "cs_test_paid1" });

    const misses = await Promise.all([
      restore({ url: "https://example.com/", email: "stranger@example.com" }),
      restore({ url: "https://another.com/", email: "owner@example.com" }),
      restore({ url: "https://example.com/", email: "early@example.com" }), // paid, but for an earlier report
    ]);
    assert.deepEqual(
      misses.map((r) => r.status),
      [404, 404, 404],
    );
    const bodies = await Promise.all(misses.map((r) => r.json()));
    assert.ok(bodies.every((b) => b.error === bodies[0].error));

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

describe("checklist audit limits", () => {
  const ip = "192.0.2.77";
  const useUpAudits = async () => {
    const { auditsPerVisitor } = await import("./limits");
    while (auditsPerVisitor.take(ip));
  };

  it("/api/audit refuses a visitor over the limit before fetching the site", async () => {
    await useUpAudits();
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response("<html></html>");
    }) as typeof fetch;
    const { GET } = await import("../app/api/audit/route");
    const res = await GET(new Request("http://localhost/api/audit?url=example.com", { headers: { "x-forwarded-for": ip } }));
    assert.equal(res.status, 429);
    assert.equal(fetches, 0);
  });

  it("/api/mcp counts tool calls, not protocol messages", async () => {
    await useUpAudits();
    const { POST: mcpPOST } = await import("../app/api/mcp/route");
    const mcp = (method: string) =>
      mcpPOST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": ip },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "tools/call" ? { name: "audit_site", arguments: { url: "example.com" } } : {} }),
        }),
      );
    const call = await mcp("tools/call");
    assert.equal(call.status, 429);
    assert.equal((await call.json()).error.code, -32000);
    assert.notEqual((await mcp("tools/list")).status, 429);
  });
});
