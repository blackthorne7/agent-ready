import { randomUUID } from "node:crypto";
import type { AgentResult, AgentStep } from "../types";
import { runStub } from "./stub";

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

export async function runAgent({ url, task, maxSteps = 10, onStep }: RunAgentOptions): Promise<RunAgentOutput> {
  const runId = randomUUID();
  const steps: AgentStep[] = [];
  const emit = async (step: AgentStep) => {
    steps.push(step);
    console.log(`[agent ${runId.slice(0, 8)}] step ${step.n} ${step.action} ${step.outcome}`);
    await onStep?.(step);
  };

  console.log(`[agent ${runId.slice(0, 8)}] start url=${url} task="${task}" maxSteps=${maxSteps} stub=${process.env.AGENT_STUB === "1"}`);
  const result = await runStub(runId, url, task, maxSteps, emit);
  console.log(`[agent ${runId.slice(0, 8)}] done status=${result.status} reason="${result.reason}"`);
  return { runId, steps, result };
}
