// The tasks the agent attempts on every audited site, run in parallel.
// Kept generic so they apply to SaaS, shops, restaurants and local businesses alike.

import type { TaskRun } from "../../src/lib/audit/types";
import type { AgentResult, AgentStep } from "../types";
import { runAgent } from "./run";

export const AGENT_MAX_STEPS = 10;

export interface AgentTask {
  id: string;
  title: string;
  task: string;
}

export const AGENT_TASKS: AgentTask[] = [
  {
    id: "find-pricing",
    title: "Find prices",
    task: "Find the prices of this business's products, services, plans or menu items.",
  },
  {
    id: "find-contact",
    title: "Find contact details",
    task: "Find a way to contact this business: an email address, a phone number or a contact form.",
  },
  {
    id: "primary-action",
    title: "Start the main action",
    task:
      "Find the main thing this site lets a customer do (for example book, reserve, order, sign up or request a demo), " +
      "reach its form, and check with fill_form whether an agent could complete it.",
  },
];

export interface AgentTaskRun extends AgentTask {
  runId: string;
  steps: AgentStep[];
  result: AgentResult;
}

export async function runAgentTasks(url: string, tasks: AgentTask[] = AGENT_TASKS): Promise<AgentTaskRun[]> {
  return Promise.all(
    tasks.map(async (t) => {
      const { runId, steps, result } = await runAgent({ url, task: t.task, maxSteps: AGENT_MAX_STEPS });
      return { ...t, runId, steps, result };
    }),
  );
}

/** The shape the audit's task-based rubric checks score (runAudit's `tasks` option). */
export function toTaskRun(run: Pick<AgentTaskRun, "id" | "task" | "steps" | "result">): TaskRun {
  return {
    taskId: run.id,
    goal: run.task,
    status: run.result.status,
    steps: run.steps.length,
    maxSteps: AGENT_MAX_STEPS,
    reason: run.result.reason,
  };
}
