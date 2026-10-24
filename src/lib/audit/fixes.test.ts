import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";
import { decodeCloudflareEmail, draftFixes } from "./fixes";

const URL_ = new URL("https://pearl.test/");

/** Encodes an address the way Cloudflare's email protection does. */
function cloudflareEncode(email: string, key = 0x5a): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return hex(key) + [...email].map((c) => hex(c.charCodeAt(0) ^ key)).join("");
}

const draft = (html: string, opts = {}) => draftFixes(cheerio.load(html), URL_, opts);
const jsonLd = (html: string, opts = {}) => JSON.parse(draft(html, opts).jsonLd);

describe("draftFixes", () => {
  it("decodes Cloudflare-protected emails and leaves their links out of llms.txt", () => {
    const enc = cloudflareEncode("hello@pearl.test");
    assert.equal(decodeCloudflareEmail(enc), "hello@pearl.test");
    const html = `<footer><a href="/pricing">Pricing</a><a href="/cdn-cgi/l/email-protection#${enc}">[email&#160;protected]</a></footer>`;
    const { llmsTxt } = draft(html);
    assert.match(llmsTxt, /Email: hello@pearl\.test/);
    assert.doesNotMatch(llmsTxt, /cdn-cgi|email.protected/);
    assert.match(llmsTxt, /\[Pricing\]\(https:\/\/pearl\.test\/pricing\)/);
  });

  it("adds a SearchAction only for a real search form", () => {
    assert.equal(jsonLd("<p>No search here</p>").potentialAction, undefined);
    const withSearch = jsonLd('<form action="/find" method="get"><input type="search" name="term"></form>');
    assert.equal(withSearch.potentialAction.target, "https://pearl.test/find?term={query}");
  });

  it("uses Organization for online businesses, without invented address or hours", () => {
    const org = jsonLd("<title>Pearl</title>", { businessType: "tech" });
    assert.equal(org["@type"], "Organization");
    assert.equal(org.openingHoursSpecification, undefined);
    assert.equal(org.address, undefined);
  });

  it("uses the specific local type, with TODO address and hours to fill in", () => {
    const local = jsonLd("<title>Joe's</title>", { businessType: "restaurant" });
    assert.equal(local["@type"], "Restaurant");
    assert.equal(local.address.streetAddress, "TODO");
    assert.equal(local.openingHoursSpecification[0].opens, "TODO");
  });

  it("doesn't advertise an MCP endpoint that may not exist", () => {
    assert.match(JSON.parse(draft("<title>Pearl</title>").mcpManifest).endpoint, /^TODO/);
  });
});
