// STUB mode (AGENT_STUB=1): no model, no network. Emits a realistic fake
// sequence of AgentSteps with short delays so the frontend can build against
// the exact shapes in types.ts.

import type { AgentResult, AgentStep } from "../types";

type FakeStep = Pick<AgentStep, "action" | "args" | "observationSummary" | "outcome">;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scenario(url: string, task: string): { steps: FakeStep[]; result: AgentResult } {
  const origin = new URL(url).origin;
  const t = task.toLowerCase();

  if (new URL(url).hostname.includes("blocked")) {
    return {
      steps: [
        {
          action: "fetch_page",
          args: { url },
          observationSummary: 'HTTP 403, title "Access denied", blocked: bot-protection challenge page (captcha)',
          outcome: "blocked",
        },
      ],
      result: {
        status: "blocked",
        reason: "The homepage returned HTTP 403 with a captcha challenge page; no content was readable without running JavaScript.",
        suggestedFix: "Allowlist well-behaved AI agent user agents (or serve a static page) instead of a captcha on the homepage.",
      },
    };
  }

  const homeSteps: FakeStep[] = [
    {
      action: "fetch_page",
      args: { url },
      observationSummary: 'HTTP 200, title "Acme Analytics — Product analytics for teams", 412 chars of text',
      outcome: "ok",
    },
    {
      action: "list_links",
      args: { url },
      observationSummary: "9 links: Home, Pricing, Book a demo, Sign up, Talk to sales, Contact, About, …",
      outcome: "ok",
    },
  ];

  if (t.includes("pric")) {
    return {
      steps: [
        ...homeSteps,
        {
          action: "fetch_page",
          args: { url: `${origin}/pricing` },
          observationSummary: 'HTTP 200, title "Pricing — Acme Analytics", 230 chars of text',
          outcome: "ok",
        },
        {
          action: "finish",
          args: { status: "success", reason: "Pricing page linked from the main nav lists Starter $29/mo, Growth $199/mo, Enterprise contact sales." },
          observationSummary: "finished: success",
          outcome: "ok",
        },
      ],
      result: {
        status: "success",
        reason: "Pricing page linked from the main nav lists Starter $29/mo, Growth $199/mo, Enterprise contact sales.",
      },
    };
  }

  if (t.includes("sign")) {
    return {
      steps: [
        ...homeSteps,
        {
          action: "fetch_page",
          args: { url: `${origin}/signup` },
          observationSummary: 'HTTP 200, title "Sign up", 0 chars of text, jsEmptyLikely: true',
          outcome: "ok",
        },
        {
          action: "finish",
          args: { status: "failed", reason: "The /signup page is rendered client-side; the fetched HTML is an empty #root div with no form." },
          observationSummary: "finished: failed",
          outcome: "ok",
        },
      ],
      result: {
        status: "failed",
        reason: "The /signup page is rendered client-side; the fetched HTML is an empty #root div with no form.",
        suggestedFix: "Server-render the signup form (or provide a <noscript> fallback) so it exists in the initial HTML.",
      },
    };
  }

  // Default: "book a demo"-style form task.
  return {
    steps: [
      ...homeSteps,
      {
        action: "list_forms",
        args: { url: `${origin}/demo` },
        observationSummary: '1 form: 3 fields (1 unlabeled), submit "Request demo"',
        outcome: "ok",
      },
      {
        action: "fill_form",
        args: { url: `${origin}/demo`, form_index: 0, values: { name: "Ada Lovelace", email: "ada@example.com" } },
        observationSummary: "dry run: cannot complete — required field company_size has no label",
        outcome: "ok",
      },
      {
        action: "finish",
        args: { status: "failed", reason: "The demo form's required field 'company_size' has no label or placeholder." },
        observationSummary: "finished: failed",
        outcome: "ok",
      },
    ],
    result: {
      status: "failed",
      reason: "The demo form at /demo has a required field 'company_size' with no <label> or placeholder, so an agent cannot tell what to enter.",
      suggestedFix: 'Add <label for="company_size">Company size</label> and a select with explicit options.',
    },
  };
}

export async function runStub(
  runId: string,
  url: string,
  task: string,
  maxSteps: number,
  emit: (step: AgentStep) => Promise<void>,
): Promise<AgentResult> {
  const delay = Number(process.env.AGENT_STUB_DELAY_MS ?? 700);
  const { steps, result } = scenario(url, task);
  let n = 0;
  for (const s of steps.slice(0, maxSteps)) {
    await sleep(delay);
    n += 1;
    await emit({ runId, n, ...s, createdAt: new Date().toISOString() });
  }
  await sleep(delay);
  return result;
}
