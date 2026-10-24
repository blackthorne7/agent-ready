import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessTypeFromBrand, type Brand } from "../context-dev";
import { applyBrand } from "./business";

const brand = (eic: { industry: string; subindustry: string }[], extra: Partial<Brand> = {}): Brand => ({
  domain: "site.test",
  industries: { eic },
  ...extra,
});

describe("businessTypeFromBrand", () => {
  it("maps specific subindustries first", () => {
    assert.equal(businessTypeFromBrand(brand([{ industry: "Hospitality & Tourism", subindustry: "Restaurants & Food Service" }])), "restaurant");
    // Software for restaurants is a software company, not a restaurant.
    assert.equal(businessTypeFromBrand(brand([{ industry: "Hospitality & Tourism", subindustry: "Restaurant Tech & Management" }])), "tech");
  });

  it("falls back to the whole industry", () => {
    assert.equal(businessTypeFromBrand(brand([{ industry: "Technology", subindustry: "Cybersecurity" }])), "tech");
    assert.equal(businessTypeFromBrand(brand([{ industry: "News & Media", subindustry: "Trade & Niche Publications" }])), "media");
  });

  it("leaves broad or ambiguous industries unmapped", () => {
    // Car makers aren't auto shops.
    assert.equal(businessTypeFromBrand(brand([{ industry: "Automotive & Transportation", subindustry: "Automotive OEMs & Vehicle Manufacturing" }])), undefined);
    assert.equal(businessTypeFromBrand(brand([])), undefined);
    assert.equal(businessTypeFromBrand(null), undefined);
  });
});

describe("applyBrand", () => {
  const restaurant = brand([{ industry: "Hospitality & Tourism", subindustry: "Restaurants & Food Service" }], {
    title: "Joe's",
    address: { city: "Austin", state_code: "TX", country_code: "US" },
  });

  it("overrides a keyword guess but not the site's own schema.org type", () => {
    assert.equal(applyBrand({ businessType: "retail", businessTypeSource: "keywords" }, restaurant).businessType, "restaurant");
    assert.equal(applyBrand({ businessType: "retail", businessTypeSource: "schema" }, restaurant).businessType, "retail");
  });

  it("keeps a keyword guess that matches one of the brand's other labels", () => {
    const wikipedia = brand([
      { industry: "Technology", subindustry: "Software (B2C)" },
      { industry: "News & Media", subindustry: "Digital Media & Content Platforms" },
    ]);
    assert.equal(applyBrand({ businessType: "media", businessTypeSource: "keywords" }, wikipedia).businessType, "media");
    assert.equal(applyBrand({ businessType: "retail", businessTypeSource: "keywords" }, wikipedia).businessType, "tech");
  });

  it("keeps a keyword match for cafe, which Context.dev files under restaurants", () => {
    assert.equal(applyBrand({ businessType: "cafe", businessTypeSource: "keywords" }, restaurant).businessType, "cafe");
  });

  it("fills a missing name and location, but keeps the page's own", () => {
    const filled = applyBrand({}, restaurant);
    assert.deepEqual([filled.name, filled.city, filled.region, filled.country], ["Joe's", "Austin", "TX", "US"]);
    assert.equal(applyBrand({ city: "Dallas" }, restaurant).city, "Dallas");
  });

  it("changes nothing without a brand", () => {
    const info = { businessType: "tech", businessTypeSource: "keywords" as const };
    assert.deepEqual(applyBrand(info, null), info);
  });
});
