import { randomUUID } from "node:crypto";
import type { AgentResult, AgentStep, FetchResult } from "../types";
import { callModel, type ChatMessage, type ToolResult } from "./model";
import { buildSystemPrompt } from "./prompt";
import { runStub } from "./stub";
import { executeTool, normalizeUrl, TOOL_DEFINITIONS, type ToolOutput } from "./tools";

const TOOL_TIMEOUT_MS = Number(process.env.AGENT_TOOL_TIMEOUT_MS ?? 15_000);
const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 120_000);

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

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

function tryNormalize(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

/** Every absolute URL that appears in a tool result becomes visitable. */
function harvestUrls(content: string, into: Set<string>) {
  for (const m of content.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
    const n = tryNormalize(m[0]);
    if (n) into.add(n);
  }
}

export async function runAgent({ url, task, maxSteps = 10, onStep }: RunAgentOptions): Promise<RunAgentOutput> {
  const runId = randomUUID();
  const tag = `[agent ${runId.slice(0, 8)}]`;
  const steps: AgentStep[] = [];
  const startedAt = Date.now();

  const emit = async (step: AgentStep) => {
    steps.push(step);
    console.log(`${tag} step ${step.n} ${step.action} ${step.outcome}`);
    try {
      await onStep?.(step);
    } catch (err) {
      console.error(`${tag} onStep callback failed:`, err);
    }
  };

  const stub = process.env.AGENT_STUB === "1";
  console.log(`${tag} start url=${url} task="${task}" maxSteps=${maxSteps} stub=${stub}`);

  let result: AgentResult;
  try {
    result = stub
      ? await runStub(runId, url, task, maxSteps, emit)
      : await loop(runId, url, task, maxSteps, emit, tag, startedAt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} error:`, err);
    result =
      err instanceof TimeoutError
        ? { status: "error", reason: `${msg} after ${steps.length} steps.` }
        : { status: "error", reason: `Agent runner error: ${msg}` };
  }

  console.log(`${tag} done status=${result.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s reason="${result.reason}"`);
  return { runId, steps, result };
}

async function loop(
  runId: string,
  startUrl: string,
  task: string,
  maxSteps: number,
  emit: (step: AgentStep) => Promise<void>,
  tag: string,
  startedAt: number,
): Promise<AgentResult> {
  const start = normalizeUrl(startUrl); // throws on a bad start URL -> caught as "error"
  const allowedUrls = new Set([start]);
  const seenActions = new Set<string>();
  const ctx = { task, cache: new Map<string, FetchResult>() };
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(maxSteps) },
    { role: "user", content: `Starting URL: ${startUrl}\nTask: ${task}` },
  ];
  let n = 0;
  let nudged = false;

  while (true) {
    const remainingMs = RUN_TIMEOUT_MS - (Date.now() - startedAt);
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
        reason: `Agent stopped without a verdict after ${n} steps. Last message: ${response.text || "(empty)"}`,
      };
    }

    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      n += 1;
      const args = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
      const targetUrl = tryNormalize(args.url);
      const actionKey = `${call.name}:${stableStringify({ ...args, ...(targetUrl ? { url: targetUrl } : {}) })}`;

      // Guardrails, checked before running the tool.
      let loopReason: string | null = null;
      let out: ToolOutput;
      if (call.name !== "finish" && seenActions.has(actionKey)) {
        loopReason = `Loop detected: the agent repeated ${call.name} on ${targetUrl ?? "the same arguments"}.`;
        out = { content: JSON.stringify({ error: loopReason }), summary: loopReason, outcome: "error" };
      } else if (call.name !== "finish" && targetUrl && !allowedUrls.has(targetUrl)) {
        const msg = `URL not allowed: ${targetUrl} has not appeared in earlier tool output. Only use URLs you have seen.`;
        out = { content: JSON.stringify({ error: msg }), summary: msg, outcome: "error" };
      } else {
        const remaining = RUN_TIMEOUT_MS - (Date.now() - startedAt);
        out = await withTimeout(executeTool(call.name, call.input, ctx), Math.min(TOOL_TIMEOUT_MS, remaining), call.name).catch(
          (err): ToolOutput => {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ error: msg }), summary: `error: ${msg}`, outcome: "error" };
          },
        );
      }
      seenActions.add(actionKey);

      await emit({
        runId,
        n,
        action: call.name,
        args,
        observationSummary: out.summary,
        outcome: out.outcome,
        createdAt: new Date().toISOString(),
      });

      if (loopReason) return { status: "failed", reason: loopReason };
      if (out.finish) return out.finish;
      if (out.outcome !== "error") harvestUrls(out.content, allowedUrls);
      results.push({ callId: call.id, content: out.content, isError: out.outcome === "error" });
      if (n >= maxSteps) break;
    }

    if (n >= maxSteps) {
      return { status: "failed", reason: `Ran out of steps (${maxSteps}) without completing the task.` };
    }
    messages.push({ role: "tool", results });
    if (n === maxSteps - 1) messages.push({ role: "user", content: "You have one step left. Call finish now." });
  }
}
