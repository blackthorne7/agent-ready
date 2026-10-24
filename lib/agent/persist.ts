// Supabase persistence for agent runs. Never throws: failures are logged and the run continues.
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. Missing env = skip.
// Table definitions: lib/agent/schema.sql

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Report } from "../../src/lib/audit";
import type { AgentResult, AgentStep } from "../types";

let client: SupabaseClient | null | undefined;

function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[persist] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; skipping Supabase writes");
    client = null;
  } else {
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

async function write(label: string, op: (c: SupabaseClient) => PromiseLike<{ error: { message: string } | null }>) {
  const c = db();
  if (!c) return;
  try {
    const { error } = await op(c);
    if (error) console.error(`[persist] ${label} failed: ${error.message}`);
    else console.log(`[persist] ${label} ok`);
  } catch (err) {
    console.error(`[persist] ${label} failed:`, err);
  }
}

export function saveRunStart(runId: string, url: string, task: string) {
  return write(`run ${runId.slice(0, 8)} start`, (c) =>
    c.from("agent_runs").insert({ run_id: runId, url, task, status: "running" }),
  );
}

export function saveStep(step: AgentStep) {
  return write(`step ${step.n}`, (c) =>
    c.from("agent_steps").insert({
      run_id: step.runId,
      n: step.n,
      action: step.action,
      args: step.args,
      observation_summary: step.observationSummary,
      outcome: step.outcome,
      created_at: step.createdAt,
    }),
  );
}

export function saveRunResult(runId: string, result: AgentResult, stepCount: number) {
  return write(`run ${runId.slice(0, 8)} result`, (c) =>
    c
      .from("agent_runs")
      .update({
        status: result.status,
        reason: result.reason,
        suggested_fix: result.suggestedFix ?? null,
        step_count: stepCount,
        finished_at: new Date().toISOString(),
      })
      .eq("run_id", runId),
  );
}

export function saveReport(report: Report, runIds: string[]) {
  return write("report", (c) =>
    c.from("audit_reports").insert({
      url: report.url,
      rubric_version: report.rubricVersion,
      score: report.score,
      coverage: report.coverage,
      task_success_rate: report.taskSuccessRate,
      category_scores: report.categories,
      report,
      run_ids: runIds,
    }),
  );
}
