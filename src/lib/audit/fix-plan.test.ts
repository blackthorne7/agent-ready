import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFixPrompt, rankFixes, scoreIfFixed } from "./fix-plan";
import type { Category, CheckResult } from "./types";

function check(id: string, category: Category, weight: number, rating: 0 | 1 | 2 | 3 | 4, extra: Partial<CheckResult> = {}): CheckResult {
  return {
    id,
    category,
    title: `Title ${id}`,
    weight,
    method: "code",
    rating,
    status: rating === 4 ? "pass" : rating >= 2 ? "warn" : "fail",
    score: rating / 4,
    detail: `Detail ${id}`,
    fix: rating < 4 ? `Fix ${id}` : undefined,
    ...extra,
  };
}

// Enough measured weight in every category for each to count toward the total.
const CHECKS: CheckResult[] = [
  check("a-big", "A", 3, 0),
  check("a-ok", "A", 1, 4),
  check("b-small", "B", 1, 2),
  check("b-ok", "B", 3, 4),
  check("c-task", "C", 3, 0, { method: "task", fix: "See each failed run's reason." }),
  check("c-ok", "C", 1, 4),
  check("d-nofix", "D", 2, 0, { fix: undefined }),
  check("d-ok", "D", 2, 4),
  check("e-ok", "E", 1, 4),
  check("f-ok", "F", 1, 4),
];

describe("rankFixes", () => {
  it("ranks by points gained and skips passing, task-only and fix-less checks", () => {
    const items = rankFixes(CHECKS);
    assert.deepEqual(
      items.map((i) => i.id),
      ["a-big", "b-small"],
    );
    assert.ok(items[0].points > items[1].points);
    assert.ok(items.every((i) => i.points > 0));
  });

  it("points match the score after fixing", () => {
    const [top] = rankFixes(CHECKS);
    assert.equal(scoreIfFixed(CHECKS, []) + top.points, scoreIfFixed(CHECKS, [top.id]));
  });

  it("points fixes at internal tools to the files on the fix page instead", () => {
    const items = rankFixes([...CHECKS, check("llms", "A", 1, 0, { fix: "Run the generate_fixes tool to draft an llms.txt from this page." })]);
    const llms = items.find((i) => i.id === "llms");
    assert.ok(llms);
    assert.doesNotMatch(llms.fix, /generate_fixes/);
    assert.match(llms.fix, /llms\.txt/);
  });
});

describe("buildFixPrompt", () => {
  it("lists the fixes in order and includes the files", () => {
    const items = rankFixes(CHECKS);
    const prompt = buildFixPrompt("https://joes.test/menu", items, {
      llmsTxt: "# Joe's",
      jsonLd: '{"@type":"Restaurant"}',
      robotsTxt: "User-agent: *",
    });
    assert.match(prompt, /https:\/\/joes\.test\b/);
    assert.ok(prompt.indexOf("1. Title a-big") < prompt.indexOf("2. Title b-small"));
    for (const part of ["# Joe's", '{"@type":"Restaurant"}', "User-agent: *"]) assert.ok(prompt.includes(part), part);
  });
});
