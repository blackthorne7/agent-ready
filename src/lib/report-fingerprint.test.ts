import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CheckResult } from "./audit/types";
import { fingerprintChecks } from "./report-fingerprint";

const status = (r: CheckResult["rating"]): CheckResult["status"] =>
  r === "na" || r === "unknown" ? r : r >= 3 ? "pass" : r === 2 ? "warn" : "fail";
const check = (id: string, rating: CheckResult["rating"], over: Partial<CheckResult> = {}): CheckResult =>
  ({ id, category: "A", title: id, weight: 1, method: "code", rating, status: status(rating), score: null, detail: "", ...over }) as CheckResult;

const base = [check("forms-labeled", 1, { evidence: ['<input name="email">'] }), check("meta", 4), check("llms-txt", 2)];

describe("report fingerprint", () => {
  it("is the same for the same fixes, in any order, with any wording or evidence", () => {
    const same = [base[2], { ...base[1], detail: "different text" }, check("forms-labeled", 1, { evidence: ['<input name="phone">'] })];
    assert.equal(fingerprintChecks(same), fingerprintChecks(base));
  });

  it("changes when the owner fixes something or a rating moves", () => {
    const fixed = [check("forms-labeled", 4), base[1], base[2]];
    const better = [check("forms-labeled", 2), base[1], base[2]];
    const broke = [...base, check("sitemap", 0)];
    for (const changed of [fixed, better, broke]) assert.notEqual(fingerprintChecks(changed), fingerprintChecks(base));
  });

  it("ignores what varies on an unchanged site: nothing-to-fix flips, load time, AI agent tasks, unmeasured checks", () => {
    const variantA = [...base, check("input-types", 4), check("response-time", 1), check("tasks-completed", 1, { method: "task" })];
    const variantB = [...base, check("input-types", "na"), check("response-time", 4), check("layout-stable", "unknown", { method: "browser" })];
    assert.equal(fingerprintChecks(variantA), fingerprintChecks(base));
    assert.equal(fingerprintChecks(variantB), fingerprintChecks(base));
  });
});
