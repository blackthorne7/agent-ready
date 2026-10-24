import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";
import { detectBusiness } from "./business";
import { classifyByKeywords } from "./classify";
import type { AuditContext, Fetched } from "./types";

const classify = (html: string, url = "https://site.test/") => classifyByKeywords(cheerio.load(html), new URL(url));

function ctxFor(html: string, jsonLd: Record<string, unknown>[] = []): AuditContext {
  const page: Fetched = {
    url: "https://site.test/",
    status: 200,
    ok: true,
    contentType: "text/html",
    body: html,
    redirects: [],
    setCookies: [],
    elapsedMs: 300,
  };
  return {
    url: new URL(page.url),
    page,
    $: cheerio.load(html),
    jsonLd,
    fetchPath: async () => ({ ...page, ok: false, status: 404, body: "" }),
    tasks: [],
  };
}

const RESTAURANT = `<title>Luigi's Pizza | Brooklyn</title>
  <meta name="description" content="Wood-fired pizza and pasta. Order online for takeout or book reservations.">
  <nav><a href="/menu">Menu</a><a href="/order">Order online</a><a href="/catering">Catering</a></nav>`;

const SAAS = `<title>Acme — product analytics</title>
  <meta name="description" content="The analytics platform for product teams. Start a free trial.">
  <nav><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/signup">Sign up</a></nav>`;

describe("classifyByKeywords", () => {
  it("recognizes a restaurant from its title, description and nav", () => {
    assert.equal(classify(RESTAURANT).businessType, "restaurant");
  });

  it("recognizes a software company", () => {
    const c = classify(SAAS);
    assert.equal(c.businessType, "tech");
    assert.ok(c.matched.includes("pricing"));
  });

  it("treats government domains as government", () => {
    assert.equal(classify("<title>Home</title>", "https://www.dmv.ca.gov/").businessType, "government");
    assert.equal(classify("<title>Home</title>", "https://www.gov.uk/").businessType, "government");
  });

  it("leaves the type unset when there is too little to go on", () => {
    assert.equal(classify("<title>Welcome</title><p>Hello there.</p>").businessType, undefined);
  });

  it("leaves the type unset when two types are close", () => {
    // Coffee shop that also serves a full menu: cafe and restaurant score about the same.
    const html = `<title>Coffee & Kitchen</title><meta name="description" content="Coffee, espresso and a full brunch menu.">`;
    assert.equal(classify(html).businessType, undefined);
  });

  it("matches whole words only", () => {
    // "ai" must not match inside "said" or "chair", nor "api" inside "rapid".
    const html = `<title>Chair said rapid</title><meta name="description" content="Chair said rapid chair said rapid.">`;
    assert.equal(classify(html).scores.tech, 0);
  });
});

describe("detectBusiness", () => {
  it("prefers schema.org structured data over keywords", () => {
    const ctx = ctxFor(SAAS, [{ "@context": "https://schema.org", "@type": "Restaurant", name: "Acme Diner" }]);
    assert.equal(detectBusiness(ctx).businessType, "restaurant");
  });

  it("falls back to keywords when there is no specific @type", () => {
    const ctx = ctxFor(SAAS, [{ "@context": "https://schema.org", "@type": "Organization", name: "Acme" }]);
    assert.equal(detectBusiness(ctx).businessType, "tech");
  });
});
