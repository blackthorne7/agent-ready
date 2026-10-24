export const dynamic = "force-static";

export function GET() {
  const body = `# Agent Ready

> Audits any website for AI agent readiness: can agents like Claude access it, understand it (hours, menus, products, contact), and act on it (MCP/OpenAPI, ordering, booking)? Returns a 0-100 score with fixes.

## Use it

- [Audit a site](/report?url=example.com): HTML report for people; needs JavaScript (it waits for a live AI agent run)
- [JSON API](/api/audit?url=example.com): GET or POST { "url": "..." }
- [MCP server](/api/mcp): streamable HTTP, tools \`audit_site\` and \`generate_fixes\`
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
