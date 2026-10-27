export type RunStatus = "success" | "failed" | "blocked" | "error";

export interface FetchResult {
  status: number;
  html: string;
  text: string;
  title: string;
  jsEmptyLikely: boolean;
  blocked: boolean;
  blockReason?: string;
}

export interface CheckResult {
  id: string;
  status: "pass" | "warn" | "fail";
  evidence: string;
  fix?: string;
}

export interface AgentStep {
  runId: string;
  n: number;
  action: string;
  args: Record<string, unknown>;
  observationSummary: string;
  outcome: "ok" | "error" | "blocked";
  createdAt: string;
}

export interface AgentResult {
  status: RunStatus;
  reason: string;
  suggestedFix?: string;
}

export interface Report {
  runId: string;
  url: string;
  task: string;
  score: number;
  checks: CheckResult[];
  steps: AgentStep[];
  agent: AgentResult;
}
