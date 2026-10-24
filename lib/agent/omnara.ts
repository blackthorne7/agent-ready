// Omnara runtime (AGENT_RUNTIME=omnara). Omnara runs the agent loop and the model;
// our five tools are Omnara custom tools, so every call comes back to this server,
// runs through ToolGuard (same guardrails as the direct loop), and we post the result.
// Docs: https://docs.omnara.com/tools/custom.md, https://docs.omnara.com/events/streaming.md
//
// Env: OMNARA_TOKEN (org API key), OMNARA_ORG_ID, OMNARA_PROJECT_ID,
//      OMNARA_PROVIDER (default omnara-openrouter), OMNARA_MODEL (default anthropic/claude-opus-5.5),
//      OMNARA_API_URL (default https://api.omnara.com/v1).

import {
  bearerToken,
  createOmnaraClient,
  openAgentEventStream,
  sdk,
  type AgentConfigDefinition,
  type AgentConfigDefinitionTool,
} from "@omnara/sdk";
import type { AgentResult } from "../types";
import { withTimeout, type ToolGuard } from "./guard";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFINITIONS } from "./tools";

const API_URL = process.env.OMNARA_API_URL ?? "https://api.omnara.com/v1";
const PROVIDER = process.env.OMNARA_PROVIDER ?? "omnara-openrouter";
const MODEL = process.env.OMNARA_MODEL ?? "anthropic/claude-opus-5.5";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Only our custom tools and no machine_sources, so the agent gets no built-in web or shell tools. */
function agentConfig(maxSteps: number): AgentConfigDefinition {
  const tools: Record<string, AgentConfigDefinitionTool> = {};
  for (const t of TOOL_DEFINITIONS) {
    tools[t.name] = {
      type: "custom",
      description: t.description,
      input_schema: JSON.parse(JSON.stringify(t.input_schema)), // drop `as const` readonly-ness
    };
  }
  return {
    version: "v1",
    instruction: buildSystemPrompt(maxSteps),
    model: { provider_config: PROVIDER, name: MODEL },
    tools,
  };
}

export async function runOmnara(opts: {
  runId: string;
  url: string;
  task: string;
  maxSteps: number;
  guard: ToolGuard;
  tag: string;
}): Promise<AgentResult> {
  const { runId, url, task, maxSteps, guard, tag } = opts;
  const client = createOmnaraClient({ baseUrl: API_URL, auth: bearerToken(requireEnv("OMNARA_TOKEN")) });
  const orgID = requireEnv("OMNARA_ORG_ID");
  const projectID = requireEnv("OMNARA_PROJECT_ID");

  const launched = await sdk.createAgent({
    client,
    path: { orgID, projectID },
    headers: { "Idempotency-Key": runId },
    body: {
      config_source: { source: agentConfig(maxSteps), source_format: "json" },
      name: `agent-ready ${runId.slice(0, 8)}`,
      message: `Starting URL: ${url}\nTask: ${task}`,
    },
  });
  const agentID = launched.data.agent.id;
  const path = { orgID, projectID, agentID };
  console.log(`${tag} omnara agent ${agentID} (${MODEL}): https://app.omnara.com/projects/${projectID}/agents/${agentID}`);

  const controller = new AbortController();
  const handled = new Set<string>();
  const seenEvents = new Set<string>();
  let nudged = false;

  // Runs every ready custom tool call we haven't handled yet, oldest first.
  const processReady = async (): Promise<AgentResult | null> => {
    const res = await sdk.listToolCalls({ client, path, query: { state: "ready", type: "custom" } });
    const calls = [...res.data.data].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const call of calls) {
      if (handled.has(call.id)) continue;
      handled.add(call.id);
      const r = await guard.run(call.name, call.input);
      await sdk.submitToolCallResult({
        client,
        path: { ...path, toolCallID: call.id },
        body: { outcome: r.isError ? "failed" : "succeeded", content_blocks: [{ type: "text", text: r.content }] },
      });
      if (r.stop) return r.stop;
    }
    return null;
  };

  // Leaving a `for await` waits for the SDK stream's cleanup, which under Next.js's patched fetch
  // can hang indefinitely. So results found inside the loop are reported through `settled` straight
  // away, and the loop is left to wind down on its own after the abort.
  let settle!: (result: AgentResult) => void;
  const settled = new Promise<AgentResult>((resolve) => (settle = resolve));
  const end = (result: AgentResult) => {
    settle(result);
    controller.abort();
    return result;
  };

  const drive = async (): Promise<AgentResult> => {
    // Lifecycle updates aren't replayed, so pick up anything that became ready before we connected.
    let stop = await processReady();
    if (stop) return stop;

    for await (const frame of openAgentEventStream({
      client,
      path,
      signal: controller.signal,
      onConnectionStateChange: (s) => {
        if (s.state === "reconnecting") console.warn(`${tag} omnara stream reconnecting (attempt ${s.attempt})`);
      },
    })) {
      if ("event_kind" in frame) {
        if (frame.event_kind !== "model_output" || seenEvents.has(frame.id)) continue;
        seenEvents.add(frame.id);

        const said = frame.content_blocks
          .map((b) => (b.type === "text" || b.type === "reasoning" ? b.text : ""))
          .filter(Boolean)
          .join(" ")
          .trim();
        if (said) console.log(`${tag} model: ${said}`);

        if (frame.content_blocks.some((b) => b.type === "tool_call")) {
          stop = await processReady();
          if (stop) return end(stop);
          continue;
        }
        if (frame.stop_reason === "max_tokens") continue; // Omnara continues the turn itself
        if (frame.stop_reason !== "end_turn") {
          return end({ status: "error", reason: `The model stopped with "${frame.stop_reason}" before reaching a verdict.` });
        }
        // Turn ended without calling finish.
        if (!nudged) {
          nudged = true;
          await sdk.createAgentInput({
            client,
            path,
            body: { content_blocks: [{ type: "text", text: "Continue using the tools, or call finish with your verdict." }] },
          });
          continue;
        }
        return end({
          status: "failed",
          reason: `Agent stopped without a verdict after ${guard.stepsUsed} steps. Last message: ${said || "(empty)"}`,
        });
      }

      if ("tool_call_id" in frame && "state" in frame && frame.state === "ready") {
        stop = await processReady();
        if (stop) return end(stop);
      }
    }
    throw new Error("Omnara event stream ended unexpectedly");
  };

  try {
    return await withTimeout(Promise.race([drive(), settled]), Math.max(0, guard.remainingMs()), "Run");
  } finally {
    controller.abort();
    // Stop any in-flight turn and retire the agent; its timeline stays viewable by ID.
    await sdk.cancelAgent({ client, path }).catch((err) => console.warn(`${tag} omnara cancel failed:`, err));
    await sdk.archiveAgent({ client, path }).catch((err) => console.warn(`${tag} omnara archive failed:`, err));
  }
}
