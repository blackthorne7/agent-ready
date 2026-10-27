// The only file that knows about the model provider. To swap providers,
// reimplement callModel() against the same neutral types below.
//
// Current provider: Anthropic (Claude) via @anthropic-ai/sdk.
// Env: ANTHROPIC_API_KEY, AGENT_MODEL (default claude-opus-5-5), AGENT_EFFORT (default medium).

import Anthropic from "@anthropic-ai/sdk";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  // `raw` carries the provider's native assistant content so it can be sent back unchanged.
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: ToolResult[] };

export interface ModelResponse {
  /** Visible text plus any progress notes the model wrote before its tool call. */
  text: string;
  toolCalls: ToolCall[];
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other";
  raw: unknown;
}

const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.AGENT_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | null = null;

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const out: Anthropic.Beta.BetaMessageParam[] = [];

  const pushUser = (blocks: Anthropic.Beta.BetaContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role: "user", content: blocks });
  };

  for (const m of messages) {
    if (m.role === "user") pushUser([{ type: "text", text: m.content }]);
    else if (m.role === "tool")
      pushUser(
        m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.callId, content: r.content, is_error: r.isError })),
      );
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: (m.raw as Anthropic.Beta.BetaContentBlockParam[] | undefined) ?? [
          ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
          ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
        ],
      });
  }
  return { system, messages: out };
}

export async function callModel(
  messages: ChatMessage[],
  tools: readonly ToolSpec[],
  opts: { signal?: AbortSignal } = {},
): Promise<ModelResponse> {
  client ??= new Anthropic();
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await client.beta.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: anthropicMessages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
      })),
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      // "updates" returns the short between-tool progress notes as thinking text.
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: EFFORT },
      // On a safety-classifier refusal, the API retries on a fallback model.
      fallbacks: "default",
      betas: ["thinking-display-updates-2026-08-18", "server-side-fallback-2026-07-01"],
    },
    { signal: opts.signal },
  );

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  const toolCalls = response.content
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const sr = response.stop_reason;
  const stopReason =
    sr === "tool_use" || sr === "end_turn" || sr === "max_tokens" || sr === "refusal" ? sr : "other";

  return { text, toolCalls, stopReason, raw: response.content };
}
