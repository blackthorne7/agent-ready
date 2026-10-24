// Usage: pnpm evaluate <url> [runsPerTask]
// AGENT_STUB=1 pnpm evaluate https://example.com
//
// Full agent-friendliness evaluation: runs the agent on each task, feeds the
// results into the audit checks, prints the scored report, saves it to
// reports/<host>-<time>.json and (if configured) Supabase audit_reports.
//
// NOTE: ../page.ts is still a stub that serves a fake site, so task results
// are not about the real URL until it fetches real pages.

import { mkdir, writeFile } from "node:fs/promises";
import { CATEGORY_ORDER, runAudit, type TaskRun } from "../../src/lib/audit";
import { saveReport } from "./persist";
import { runAgent } from "./run";

try {
  process.loadEnvFile(); // optional .env in the project root
} catch {
  // no .env, fine
}

// Universal tasks from evals/AGENT_CHECKS.md ("Any site"). Prefix ids with
// "search" or "multistep" to feed those checks.
const TASKS = [
  { taskId: "find-contact", goal: "Find how to contact this business (phone, email or a contact form)" },
  { taskId: "find-privacy", goal: "Find the privacy policy" },
  { taskId: "find-pricing", goal: "Find pricing information" },
];
const MAX_STEPS = 10;

async function main() {
  const [url, runsArg] = process.argv.slice(2);
  if (!url) {
    console.error("Usage: pnpm evaluate <url> [runsPerTask]");
    process.exit(1);
  }
  const runs = Math.max(1, Number(runsArg ?? 1));

  const tasks: TaskRun[] = [];
  const runIds: string[] = [];
  for (const t of TASKS) {
    for (let i = 0; i < runs; i++) {
      const { runId, steps, result } = await runAgent({ url, task: t.goal, maxSteps: MAX_STEPS });
      runIds.push(runId);
      tasks.push({ ...t, status: result.status, steps: steps.length, maxSteps: MAX_STEPS, reason: result.reason });
    }
  }

  const report = await runAudit(url, { tasks });

  console.log(`\n=== ${report.url} ===`);
  if (report.error) console.log(`error: ${report.error}`);
  console.log(`score ${report.score ?? "—"} (${report.grade})  coverage ${Math.round(report.coverage * 100)}%  tasks ${report.taskSuccessRate == null ? "—" : `${Math.round(report.taskSuccessRate * 100)}%`}`);
  for (const c of CATEGORY_ORDER) {
    const cat = report.categories[c];
    console.log(`  ${c} ${String(cat.score ?? "—").padStart(3)}  ${String(Math.round(cat.coverage * 100)).padStart(3)}% measured  ${cat.label}`);
  }
  const failing = report.checks.filter((r) => r.status === "fail" || r.status === "warn");
  if (failing.length) {
    console.log("\nTo improve:");
    for (const r of failing) console.log(`  [${r.category}] ${r.title}: ${r.detail}`);
  }

  await mkdir("reports", { recursive: true });
  const file = `reports/${new URL(report.url).hostname}-${report.auditedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`\nSaved ${file}`);
  await saveReport(report, runIds);
}

void main();
