// Usage: pnpm evaluate <url> [runsPerTask]
// AGENT_STUB=1 pnpm evaluate https://example.com
//
// Full agent-friendliness evaluation: runs the agent on each task, feeds the
// results into the audit checks, prints the scored report, saves it to
// reports/<host>-<time>.json and (if configured) Supabase audit_reports.
//
// Tasks are AGENT_TASKS (./tasks), the same ones the report page runs.
// AGENT_FAKE_SITE=1 points the agent at lib/page-fake.ts instead of the real site.

import { mkdir, writeFile } from "node:fs/promises";
import { CATEGORY_ORDER, runAudit, type TaskRun } from "../../src/lib/audit";
import { saveReport } from "./persist";
import { runAgent } from "./run";
import { AGENT_TASKS } from "./tasks";

try {
  process.loadEnvFile(); // optional .env in the project root
} catch {
  // no .env, fine
}

// Task ids starting with "search" or "multistep" also feed those checks.
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
  for (const t of AGENT_TASKS) {
    for (let i = 0; i < runs; i++) {
      const { runId, steps, result } = await runAgent({ url, task: t.task, maxSteps: MAX_STEPS });
      runIds.push(runId);
      tasks.push({ taskId: t.id, goal: t.task, status: result.status, steps: steps.length, maxSteps: MAX_STEPS, reason: result.reason });
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
