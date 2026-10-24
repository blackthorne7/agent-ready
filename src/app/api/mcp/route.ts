import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { runAudit } from "@/lib/audit";
import { generateFixes } from "@/lib/audit/fixes";
import { saveAudit } from "@/lib/audit/save";

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
        const fixes = await generateFixes(url);
        return {
          content: [{ type: "text", text: JSON.stringify(fixes, null, 2) }],
          structuredContent: fixes as unknown as Record<string, unknown>,
        };
      },
    );
  },
  { serverInfo: { name: "agent-ready", version: "0.1.0" } },
);

export { handler as GET, handler as POST, handler as DELETE };
