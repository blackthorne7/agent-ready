import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeBlock, detectBlocker, UNBLOCK_STEPS, CHECKER_UA_TOKEN } from "./blocked";
import type { Fetched } from "./types";

function res(over: Partial<Fetched> = {}): Fetched {
  return { url: "https://shop.test/", status: 200, ok: true, contentType: "text/html", body: "", redirects: [], setCookies: [], headers: {}, elapsedMs: 50, ...over };
}

const forbidden = (over: Partial<Fetched> = {}) => res({ status: 403, ok: false, ...over });

describe("detectBlocker", () => {
  it("names the bot protection from headers, cookies or body", () => {
    assert.equal(detectBlocker(forbidden({ headers: { server: "cloudflare", "cf-ray": "8abc-SFO" } })), "cloudflare");
    assert.equal(detectBlocker(forbidden({ headers: { server: "AkamaiGHost" } })), "akamai");
    assert.equal(detectBlocker(forbidden({ setCookies: ["datadome=abc; Path=/"] })), "datadome");
    assert.equal(detectBlocker(forbidden({ setCookies: ["_pxhd=xyz; Path=/"] })), "human");
    assert.equal(detectBlocker(forbidden({ headers: { "x-iinfo": "1-2-3" } })), "imperva");
    assert.equal(detectBlocker(forbidden({ headers: { "x-amzn-waf-action": "block" } })), "aws");
    assert.equal(detectBlocker(forbidden({ headers: { "x-vercel-mitigated": "challenge" } })), "vercel");
    assert.equal(detectBlocker(forbidden({ headers: { "x-sucuri-id": "1" } })), "sucuri");
    assert.equal(detectBlocker(forbidden({ headers: { server: "nginx" } })), null);
  });

  it("prefers the bot manager over the CDN in front of it", () => {
    assert.equal(detectBlocker(forbidden({ headers: { server: "cloudflare", "cf-ray": "1", "x-datadome": "protected" } })), "datadome");
  });

  it("gives every blocker, and the unknown case, steps that let our checker in", () => {
    for (const steps of Object.values(UNBLOCK_STEPS)) assert.ok(steps.some((s) => s.includes(CHECKER_UA_TOKEN)));
  });
});

describe("describeBlock", () => {
  it("reports what agents can still read", async () => {
    const files: Record<string, Fetched> = {
      "/robots.txt": res({ contentType: "text/plain", body: "User-agent: GPTBot\nDisallow: /\n\nSitemap: https://shop.test/sitemap.xml" }),
      "/llms.txt": res({ status: 404, ok: false }),
      "/sitemap.xml": forbidden(),
    };
    const access = await describeBlock(forbidden({ headers: { "cf-ray": "1" } }), async (p) => files[p]);
    assert.deepEqual(access, {
      reason: "HTTP 403",
      blocker: "cloudflare",
      robots: "found",
      robotsBlocks: ["GPTBot"],
      llmsTxt: "missing",
      // Declared in the readable robots.txt, so agents can find it even though the file itself 403s.
      sitemap: "found",
    });
  });

  it("marks files the bot wall also blocks", async () => {
    const access = await describeBlock(forbidden(), async () => forbidden());
    assert.equal(access.robots, "blocked");
    assert.deepEqual(access.robotsBlocks, []);
    assert.equal(access.llmsTxt, "blocked");
    assert.equal(access.sitemap, "blocked");
    assert.equal(access.blocker, null);
  });
});
