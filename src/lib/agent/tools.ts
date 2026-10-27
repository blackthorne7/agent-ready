// Tool implementations for the agent. Each wraps the page utilities in
// ../page and returns a string for the model (truncated to ~3000 tokens)
// plus a one-line summary and outcome for AgentStep.

import { z } from "zod";
import { extractForms, extractLinks, fetchPage, type FormField } from "../page";
import type { AgentResult, FetchResult } from "../types";

export const USER_AGENT =
  "AgentReadyAuditor/0.1 (+https://github.com/leoi137/agent-ready; read-only, never submits forms)";

// ~3000 tokens at ~4 chars/token.
const MAX_RESULT_CHARS = 12_000;
const MAX_PAGE_TEXT_CHARS = 10_000;
const MAX_LINKS = 60;

// Provider-neutral tool definitions (JSON Schema). model.ts converts them.
export const TOOL_DEFINITIONS = [
  {
    name: "fetch_page",
    description:
      "Fetch a page and return cleaned main text, title, HTTP status, and whether the content looks empty or JS-rendered.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_links",
    description: "List links on a page as {text, href}, including nav and footer. Truncated to the most relevant 60.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_forms",
    description:
      "List forms on a page with each field's name, type, label (or null if missing), required flag, and the submit button text.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "fill_form",
    description:
      "Dry run only. Given a form and values for its fields, report whether every required field could be identified and filled, and what is missing or ambiguous. Does NOT submit.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        form_index: { type: "integer" },
        values: { type: "object" },
      },
      required: ["url", "form_index", "values"],
    },
  },
  {
    name: "finish",
    description: "End the run with a verdict.",
    input_schema: {
      type: "object",
      properties: {
        status: { enum: ["success", "failed", "blocked"] },
        reason: { type: "string" },
        suggested_fix: { type: "string" },
      },
      required: ["status", "reason"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

const UrlInput = z.object({ url: z.string().url() });
const FillFormInput = z.object({
  url: z.string().url(),
  form_index: z.number().int().min(0),
  values: z.record(z.string(), z.unknown()),
});
const FinishInput = z.object({
  status: z.enum(["success", "failed", "blocked"]),
  reason: z.string().min(1),
  suggested_fix: z.string().optional(),
});

export interface ToolContext {
  task: string;
  /** Per-run page cache so list_links/list_forms don't refetch. */
  cache: Map<string, FetchResult>;
}

export interface ToolOutput {
  /** What the model sees (JSON string, truncated). */
  content: string;
  /** One line for AgentStep.observationSummary. */
  summary: string;
  outcome: "ok" | "error" | "blocked";
  /** Set only by finish. */
  finish?: AgentResult;
}

export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

export function truncate(s: string, max = MAX_RESULT_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

async function getPage(ctx: ToolContext, url: string): Promise<FetchResult> {
  const key = normalizeUrl(url);
  const cached = ctx.cache.get(key);
  if (cached) return cached;
  const page = await fetchPage(url, { userAgent: USER_AGENT });
  ctx.cache.set(key, page);
  return page;
}

function blockedOutput(url: string, page: FetchResult): ToolOutput {
  return {
    content: JSON.stringify({ url, status: page.status, blocked: true, blockReason: page.blockReason ?? null }),
    summary: `HTTP ${page.status}, blocked: ${page.blockReason ?? "unknown reason"}`,
    outcome: "blocked",
  };
}

async function fetchPageTool(input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const { url } = UrlInput.parse(input);
  const page = await getPage(ctx, url);
  const result = {
    url,
    status: page.status,
    title: page.title,
    jsEmptyLikely: page.jsEmptyLikely,
    blocked: page.blocked,
    blockReason: page.blockReason ?? null,
    text: truncate(page.text, MAX_PAGE_TEXT_CHARS),
  };
  const flags = [page.jsEmptyLikely && "jsEmptyLikely", page.blocked && `blocked (${page.blockReason ?? "?"})`]
    .filter(Boolean)
    .join(", ");
  return {
    content: truncate(JSON.stringify(result)),
    summary: `HTTP ${page.status}, "${page.title}", ${page.text.length} chars${flags ? `, ${flags}` : ""}`,
    outcome: page.blocked ? "blocked" : "ok",
  };
}

async function listLinksTool(input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const { url } = UrlInput.parse(input);
  const page = await getPage(ctx, url);
  if (page.blocked) return blockedOutput(url, page);

  const seen = new Set<string>();
  const links = extractLinks(page.html, url).filter((l) => {
    if (!/^https?:/i.test(l.href) || seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });

  // "Most relevant": links whose text/href mention task words float to the top.
  const words = ctx.task.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = (text: string, href: string) => {
    const hay = `${text} ${href}`.toLowerCase();
    return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  const ranked = links
    .map((l, i) => ({ l, i, s: score(l.text, l.href) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MAX_LINKS)
    .map(({ l }) => ({ text: l.text.slice(0, 120), href: l.href }));

  return {
    content: truncate(JSON.stringify({ url, total: links.length, shown: ranked.length, links: ranked })),
    summary: `${links.length} links${ranked.length ? `: ${ranked.slice(0, 6).map((l) => l.text || l.href).join(", ")}` : ""}${ranked.length > 6 ? ", …" : ""}`,
    outcome: "ok",
  };
}

async function listFormsTool(input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const { url } = UrlInput.parse(input);
  const page = await getPage(ctx, url);
  if (page.blocked) return blockedOutput(url, page);

  const forms = extractForms(page.html).map((f, index) => ({ index, ...f }));
  const unlabeled = forms.reduce((n, f) => n + f.fields.filter((x) => !x.label).length, 0);
  return {
    content: truncate(JSON.stringify({ url, forms, jsEmptyLikely: page.jsEmptyLikely })),
    summary: forms.length
      ? `${forms.length} form(s): ${forms.map((f) => `#${f.index} ${f.fields.length} fields, submit "${f.submitText ?? "?"}"${f.captcha ? ", captcha" : ""}`).join("; ")}${unlabeled ? ` (${unlabeled} unlabeled fields)` : ""}`
      : `no forms${page.jsEmptyLikely ? " (page looks JS-rendered)" : ""}`,
    outcome: "ok",
  };
}

const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fillFormTool(input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const { url, form_index, values } = FillFormInput.parse(input);
  const page = await getPage(ctx, url);
  if (page.blocked) return blockedOutput(url, page);

  const forms = extractForms(page.html);
  const form = forms[form_index];
  if (!form) {
    return {
      content: JSON.stringify({ error: `form_index ${form_index} out of range; page has ${forms.length} form(s)` }),
      summary: `no form #${form_index} (page has ${forms.length})`,
      outcome: "error",
    };
  }

  const valueKeys = new Map(Object.keys(values).map((k) => [keyOf(k), k]));
  const used = new Set<string>();
  const findValue = (f: FormField) => {
    for (const cand of [f.name, f.label]) {
      const k = cand && valueKeys.get(keyOf(cand));
      if (k) {
        used.add(k);
        return k;
      }
    }
    return null;
  };

  const filled: string[] = [];
  const missing: string[] = [];
  const unidentifiable: string[] = [];
  const warnings: string[] = [];
  for (const f of form.fields) {
    const id = f.label ?? f.name ?? `(unnamed ${f.type})`;
    if (!f.label && !f.name) {
      if (f.required) unidentifiable.push(`required ${f.type} field with no label and no name`);
      continue;
    }
    if (!f.label)
      warnings.push(
        `field "${f.name}" has no label; meaning inferred from its name${f.placeholder ? ` and placeholder "${f.placeholder}"` : ""} only`,
      );
    const k = findValue(f);
    if (k) filled.push(id);
    else if (f.required) missing.push(id);
  }
  const unmatched = Object.keys(values).filter((k) => !used.has(k));
  if (unmatched.length) warnings.push(`values not matching any field: ${unmatched.join(", ")}`);

  if (form.captcha) warnings.push("the form has a captcha, so submitting it likely needs a human");

  const canComplete = missing.length === 0 && unidentifiable.length === 0;
  const result = {
    dryRun: true,
    submitted: false,
    url,
    form_index,
    canComplete,
    submitText: form.submitText,
    filled,
    missing,
    unidentifiable,
    warnings,
  };
  return {
    content: truncate(JSON.stringify(result)),
    summary: `dry run: ${canComplete ? "can complete" : "cannot complete"}; filled ${filled.length}, missing ${missing.length}, unidentifiable ${unidentifiable.length}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
    outcome: "ok",
  };
}

function finishTool(input: unknown): ToolOutput {
  const { status, reason, suggested_fix } = FinishInput.parse(input);
  return {
    content: JSON.stringify({ ok: true }),
    summary: `finished: ${status}`,
    outcome: "ok",
    finish: { status, reason, suggestedFix: suggested_fix },
  };
}

/** Runs one tool. Bad input or a thrown error becomes an "error" ToolOutput; never throws. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  try {
    switch (name) {
      case "fetch_page":
        return await fetchPageTool(input, ctx);
      case "list_links":
        return await listLinksTool(input, ctx);
      case "list_forms":
        return await listFormsTool(input, ctx);
      case "fill_form":
        return await fillFormTool(input, ctx);
      case "finish":
        return finishTool(input);
      default:
        return { content: JSON.stringify({ error: `unknown tool ${name}` }), summary: `unknown tool ${name}`, outcome: "error" };
    }
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? `invalid input: ${err.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { content: JSON.stringify({ error: msg }), summary: `error: ${msg}`, outcome: "error" };
  }
}
