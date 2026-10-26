import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter, TtlCache, clientIp, takeAudit } from "./limits";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("reuses a value until it expires", async () => {
    const c = clock();
    const cache = new TtlCache<number>(1000, 10, c.now);
    let runs = 0;
    const run = async () => ++runs;
    assert.deepEqual(await cache.get("a", run), { value: 1, cached: false });
    assert.deepEqual(await cache.get("a", run), { value: 1, cached: true });
    c.advance(1001);
    assert.equal(cache.has("a"), false);
    assert.deepEqual(await cache.get("a", run), { value: 2, cached: false });
  });

  it("shares one run between concurrent callers", async () => {
    const cache = new TtlCache<number>(1000, 10);
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async () => {
      runs++;
      await gate;
      return 42;
    };
    const first = cache.get("a", run);
    assert.equal(cache.has("a"), true);
    const second = cache.get("a", run);
    release();
    assert.deepEqual(await Promise.all([first, second]), [
      { value: 42, cached: false },
      { value: 42, cached: true },
    ]);
    assert.equal(runs, 1);
  });

  it("re-runs on refresh and caches the new value", async () => {
    const cache = new TtlCache<number>(1000, 10);
    let runs = 0;
    const run = async () => ++runs;
    await cache.get("a", run);
    assert.deepEqual(await cache.get("a", run, { refresh: true }), { value: 2, cached: false });
    assert.deepEqual(await cache.get("a", run), { value: 2, cached: true });
  });

  it("doesn't cache failures", async () => {
    const cache = new TtlCache<number>(1000, 10);
    await assert.rejects(cache.get("a", async () => Promise.reject(new Error("boom"))));
    assert.equal(cache.has("a"), false);
    assert.deepEqual(await cache.get("a", async () => 7), { value: 7, cached: false });
  });

  it("evicts the oldest entry past the size limit", async () => {
    const cache = new TtlCache<string>(1000, 2);
    for (const k of ["a", "b", "c"]) await cache.get(k, async () => k);
    assert.deepEqual(["a", "b", "c"].map((k) => cache.has(k)), [false, true, true]);
  });
});

describe("RateLimiter", () => {
  it("allows `limit` uses per window, then frees them as the window slides", () => {
    const c = clock();
    const limiter = new RateLimiter(2, 1000, c.now);
    assert.equal(limiter.take("ip"), true);
    c.advance(500);
    assert.equal(limiter.take("ip"), true);
    assert.equal(limiter.take("ip"), false);
    assert.equal(limiter.take("other"), true); // keys are independent
    c.advance(501); // the first use is now outside the window
    assert.equal(limiter.take("ip"), true);
    assert.equal(limiter.take("ip"), false);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("https://site.test/", { headers });
  it("takes the first X-Forwarded-For address", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  });
  it("falls back to X-Real-IP, or null", () => {
    assert.equal(clientIp(req({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientIp(req({})), null);
  });
  it("reads plain Headers too (server components get those, not a Request)", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.8" })), "203.0.113.8");
  });
});

describe("takeAudit", () => {
  it("allows 60 audits an hour per visitor, and doesn't limit requests with no IP", () => {
    const visitor = new Headers({ "x-forwarded-for": "192.0.2.60" });
    const results = Array.from({ length: 61 }, () => takeAudit(visitor));
    assert.equal(results.filter(Boolean).length, 60);
    assert.equal(results[60], false);
    assert.equal(takeAudit(new Headers({ "x-forwarded-for": "192.0.2.61" })), true);
    assert.equal(takeAudit(new Headers()), true);
  });
});
