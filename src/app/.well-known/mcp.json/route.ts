export const dynamic = "force-static";

export function GET() {
  return Response.json({
    name: "agent-ready",
    description: "Audit websites for AI agent readiness and generate fixes.",
    endpoint: "/api/mcp",
    transport: "streamable-http",
    tools: ["audit_site", "generate_fixes"],
  });
}
