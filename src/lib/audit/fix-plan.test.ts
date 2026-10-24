import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFixPrompt, rankFixes, scoreIfFixed } from "./fix-plan";
import type { Category, CheckResult, TaskRun } from "./types";

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

  it("puts what matters for the business type first, then points", () => {
    const checks = [...CHECKS, check("offerings", "A", 1, 2), check("feeds", "A", 1, 2)];
    assert.deepEqual(
      rankFixes(checks, [], 8, "restaurant").map((i) => i.id),
      ["offerings", "a-big", "b-small", "feeds"],
    );
    assert.deepEqual(
      rankFixes(checks, [], 8, "media").map((i) => i.id),
      ["feeds", "a-big", "b-small", "offerings"],
    );
    assert.equal(rankFixes(checks, [], 8, "other")[0].id, "a-big");
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

const task = (taskId: string, status: TaskRun["status"], extra: Partial<TaskRun> = {}): TaskRun => ({
  taskId,
  title: `Do ${taskId}`,
  goal: `Goal ${taskId}`,
  status,
  steps: 3,
  maxSteps: 10,
  reason: `Reason ${taskId}`,
  ...extra,
});

describe("agent findings and developer fixes", () => {
  it("puts tasks the agent got stuck on first, with its own fix", () => {
    const items = rankFixes(CHECKS, [
      task("ok", "success"),
      task("stuck", "failed", { fix: "Add a plain mailto: link." }),
      task("wall", "blocked"),
      task("broke", "error"),
    ]);
    assert.deepEqual(
      items.slice(0, 2).map((i) => [i.id, i.source]),
      [
        ["agent-stuck", "agent"],
        ["agent-wall", "agent"],
      ],
    );
    assert.equal(items[0].fix, "Add a plain mailto: link.");
    assert.match(items[0].title, /Do stuck/);
    assert.ok(items[1].fix.length > 0); // a default when the agent gave none
    assert.ok(!items.some((i) => i.id === "agent-ok" || i.id === "agent-broke"));
  });

  it("flags developer-only fixes and gives them their own section in the prompt", () => {
    const checks = [...CHECKS, check("agent-protocols", "D", 2, 0, { title: "Agent endpoint" })];
    const items = rankFixes(checks);
    assert.equal(items.find((i) => i.id === "agent-protocols")?.developer, true);
    assert.equal(items.find((i) => i.id === "a-big")?.developer, false);

    const prompt = buildFixPrompt("https://joes.test/", items, { llmsTxt: "", jsonLd: "{}", robotsTxt: "" });
    const devSection = prompt.indexOf("## For a developer");
    assert.ok(devSection > 0);
    assert.ok(prompt.indexOf("Agent endpoint") > devSection);
    assert.ok(prompt.indexOf("Title a-big") < devSection);
    assert.match(prompt, /never publish the word TODO/);
  });
});
