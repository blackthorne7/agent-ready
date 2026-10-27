// Guardrails shared by every runtime (direct model loop, Omnara). Each tool call
// the model makes goes through ToolGuard.run(), which enforces the step limit,
// loop detection, the URL allowlist and the per-tool timeout, then records an AgentStep.

import type { AgentResult, AgentStep, FetchResult } from "../types";
import { executeTool, normalizeUrl, type ToolContext, type ToolOutput } from "./tools";

export const TOOL_TIMEOUT_MS = Number(process.env.AGENT_TOOL_TIMEOUT_MS ?? 15_000);
export const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 120_000);

export class TimeoutError extends Error {}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

export interface GuardedResult {
  /** What to hand back to the model. */
  content: string;
  isError: boolean;
  /** Set when the run should end now (finish, loop detected, out of steps). */
  stop: AgentResult | null;
}

export class ToolGuard {
  private readonly allowedUrls: Set<string>;
  private readonly seenActions = new Set<string>();
  private readonly ctx: ToolContext;
  private n = 0;

  constructor(
    private readonly runId: string,
    startUrl: string,
    task: string,
    private readonly maxSteps: number,
    private readonly startedAt: number,
    private readonly emit: (step: AgentStep) => Promise<void>,
  ) {
    this.allowedUrls = new Set([normalizeUrl(startUrl)]); // throws on a bad start URL
    this.ctx = { task, cache: new Map<string, FetchResult>() };
  }

  get stepsUsed() {
    return this.n;
  }

  get stepsLeft() {
    return this.maxSteps - this.n;
  }

  remainingMs() {
    return RUN_TIMEOUT_MS - (Date.now() - this.startedAt);
  }

  async run(name: string, input: unknown): Promise<GuardedResult> {
    this.n += 1;
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const targetUrl = tryNormalize(args.url);
    const actionKey = `${name}:${stableStringify({ ...args, ...(targetUrl ? { url: targetUrl } : {}) })}`;

    let loopReason: string | null = null;
    let out: ToolOutput;
    if (name !== "finish" && this.seenActions.has(actionKey)) {
      loopReason = `Loop detected: the agent repeated ${name} on ${targetUrl ?? "the same arguments"}.`;
      out = { content: JSON.stringify({ error: loopReason }), summary: loopReason, outcome: "error" };
    } else if (name !== "finish" && targetUrl && !this.allowedUrls.has(targetUrl)) {
      const msg = `URL not allowed: ${targetUrl} has not appeared in earlier tool output. Only use URLs you have seen.`;
      out = { content: JSON.stringify({ error: msg }), summary: msg, outcome: "error" };
    } else {
      const timeout = Math.max(0, Math.min(TOOL_TIMEOUT_MS, this.remainingMs()));
      out = await withTimeout(executeTool(name, input, this.ctx), timeout, name).catch((err): ToolOutput => {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: JSON.stringify({ error: msg }), summary: `error: ${msg}`, outcome: "error" };
      });
    }
    this.seenActions.add(actionKey);

    await this.emit({
      runId: this.runId,
      n: this.n,
      action: name,
      args,
      observationSummary: out.summary,
      outcome: out.outcome,
      createdAt: new Date().toISOString(),
    });

    if (out.outcome !== "error") {
      // Every absolute URL in a tool result becomes visitable.
      for (const m of out.content.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
        const u = tryNormalize(m[0]);
        if (u) this.allowedUrls.add(u);
      }
    }

    let stop: AgentResult | null = null;
    if (loopReason) stop = { status: "failed", reason: loopReason };
    else if (out.finish) stop = out.finish;
    else if (this.n >= this.maxSteps)
      stop = { status: "failed", reason: `Ran out of steps (${this.maxSteps}) without completing the task.` };

    return { content: out.content, isError: out.outcome === "error", stop };
  }
}
