import { randomUUID } from "node:crypto";
import type { AgentResult, AgentStep } from "../types";
import { RUN_TIMEOUT_MS, TimeoutError, ToolGuard, withTimeout } from "./guard";
import { callModel, type ChatMessage, type ToolResult } from "./model";
import { runOmnara } from "./omnara";
import { saveRunResult, saveRunStart, saveStep } from "./persist";
import { buildSystemPrompt } from "./prompt";
import { runStub } from "./stub";
import { TOOL_DEFINITIONS } from "./tools";

export interface RunAgentOptions {
  url: string;
  task: string;
  maxSteps?: number;
  /** Called after every step, as it happens. */
  onStep?: (step: AgentStep) => void | Promise<void>;
}

export interface RunAgentOutput {
  runId: string;
  steps: AgentStep[];
  result: AgentResult;
}

/** AGENT_STUB=1 wins; otherwise AGENT_RUNTIME=omnara or the direct model loop (default). */
function runtime(): "stub" | "omnara" | "direct" {
  if (process.env.AGENT_STUB === "1") return "stub";
  return process.env.AGENT_RUNTIME === "omnara" ? "omnara" : "direct";
}

export async function runAgent({ url, task, maxSteps = 10, onStep }: RunAgentOptions): Promise<RunAgentOutput> {
  const runId = randomUUID();
  const tag = `[agent ${runId.slice(0, 8)}]`;
  const steps: AgentStep[] = [];
  const startedAt = Date.now();

  const emit = async (step: AgentStep) => {
    steps.push(step);
    console.log(`${tag} step ${step.n} ${step.action} ${step.outcome}`);
    await saveStep(step);
    try {
      await onStep?.(step);
    } catch (err) {
      console.error(`${tag} onStep callback failed:`, err);
    }
  };

  const mode = runtime();
  console.log(`${tag} start url=${url} task="${task}" maxSteps=${maxSteps} runtime=${mode}`);

  await saveRunStart(runId, url, task);

  let result: AgentResult;
  try {
    if (mode === "stub") {
      result = await runStub(runId, url, task, maxSteps, emit);
    } else {
      const guard = new ToolGuard(runId, url, task, maxSteps, startedAt, emit);
      result =
        mode === "omnara"
          ? await runOmnara({ runId, url, task, maxSteps, guard, tag })
          : await runDirect(url, task, maxSteps, guard, tag);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} error:`, err);
    result =
      err instanceof TimeoutError
        ? { status: "error", reason: `${msg} after ${steps.length} steps.` }
        : { status: "error", reason: `Agent runner error: ${msg}` };
  }

  await saveRunResult(runId, result, steps.length);
  console.log(`${tag} done status=${result.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s reason="${result.reason}"`);
  return { runId, steps, result };
}

/** Our own tool-calling loop against callModel() (model.ts). */
async function runDirect(startUrl: string, task: string, maxSteps: number, guard: ToolGuard, tag: string): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(maxSteps) },
    { role: "user", content: `Starting URL: ${startUrl}\nTask: ${task}` },
  ];
  let nudged = false;

  while (true) {
    const remainingMs = guard.remainingMs();
    if (remainingMs <= 0) throw new TimeoutError(`Run timed out after ${RUN_TIMEOUT_MS / 1000}s`);
    const controller = new AbortController();
    const response = await withTimeout(callModel(messages, TOOL_DEFINITIONS, { signal: controller.signal }), remainingMs, "Run").catch(
      (err) => {
        controller.abort();
        throw err;
      },
    );
    messages.push({ role: "assistant", text: response.text, toolCalls: response.toolCalls, raw: response.raw });
    if (response.text) console.log(`${tag} model: ${response.text}`);

    if (response.toolCalls.length === 0) {
      if (response.stopReason === "refusal") return { status: "error", reason: "The model declined to continue this request." };
      if (!nudged) {
        nudged = true;
        messages.push({ role: "user", content: "Continue using the tools, or call finish with your verdict." });
        continue;
      }
      return {
        status: "failed",
        reason: `Agent stopped without a verdict after ${guard.stepsUsed} steps. Last message: ${response.text || "(empty)"}`,
      };
    }

    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      const r = await guard.run(call.name, call.input);
      if (r.stop) return r.stop;
      results.push({ callId: call.id, content: r.content, isError: r.isError });
    }
    messages.push({ role: "tool", results });
    if (guard.stepsLeft === 1) messages.push({ role: "user", content: "You have one step left. Call finish now." });
  }
}
