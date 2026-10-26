import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { normalizeUrl, runAudit } from "@/lib/audit";
import { generateFixes } from "@/lib/audit/fixes";
import { saveAudit } from "@/lib/audit/save";
import { getBrand } from "@/lib/context-dev";
import { AUDIT_LIMIT_MESSAGE, takeAudit } from "@/lib/limits";

export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "audit_site",
      {
        title: "Audit a website for agent readiness",
        description:
          "Scores how agent-friendly a website is on six categories (A discoverability, B controls, C tasks, D programmatic access, E robustness, F safety), including cookie/consent/session checks. Returns a 0-100 score, coverage (share of checks actually measured), per-check 0-4 ratings with evidence and fixes. Blocked sites get no score.",
        inputSchema: z.object({ url: z.string().describe("Website URL or domain, e.g. https://example.com") }),
      },
      async ({ url }) => {
        const report = await runAudit(url);
        await saveAudit(report);
        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      },
    );

    server.registerTool(
      "generate_fixes",
      {
        title: "Generate agent-readiness fixes",
        description:
          "Drafts copy-paste fixes for a website from its current content: llms.txt, schema.org JSON-LD, an agent-friendly robots.txt and an MCP manifest. Fields marked TODO need the owner's real data.",
        inputSchema: z.object({ url: z.string().describe("Website URL or domain") }),
      },
      async ({ url }) => {
        const brand = await getBrand(new URL(normalizeUrl(url)).hostname.replace(/^www\./, ""), 15_000);
        const fixes = await generateFixes(url, { brand });
        return {
          content: [{ type: "text", text: JSON.stringify(fixes, null, 2) }],
          structuredContent: fixes as unknown as Record<string, unknown>,
        };
      },
    );
  },
  { serverInfo: { name: "agent-ready", version: "0.1.0" } },
);

/**
 * Each tool call (audit_site, generate_fixes) counts as one audit for the visitor. Protocol
 * messages (initialize, tools/list) are free, so clients can connect without using up the limit.
 */
async function POST(req: Request) {
  const body: unknown = await req.clone().json().catch(() => null);
  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => (m as { method?: unknown } | null)?.method === "tools/call");
  if (calls.some(() => !takeAudit(req))) {
    const id = (calls[0] as { id?: unknown }).id ?? null;
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32000, message: AUDIT_LIMIT_MESSAGE } }, { status: 429 });
  }
  return handler(req);
}

export { handler as GET, POST, handler as DELETE };
