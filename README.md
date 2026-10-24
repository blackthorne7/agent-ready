# agent-ready

Lighthouse for AI agents. Audits any website for whether agents like Claude can **get in**, **understand it** (hours, location, menus, products, contact) and **take action** (MCP/A2A/OpenAPI endpoints, declared order/reserve actions, labeled forms), then returns a 0-100 score with copy-paste fixes.

Live: https://snowy-thunder-epw3bj03.sfo.unikraft.app

## Use it

- **Web:** `/report?url=example.com` (server-rendered, works without JavaScript)
- **JSON API:** `GET /api/audit?url=example.com` or `POST /api/audit` with `{ "url": "..." }`
- **MCP server:** `/api/mcp` (streamable HTTP), tools `audit_site` and `generate_fixes`

```bash
claude mcp add --transport http agent-ready https://snowy-thunder-epw3bj03.sfo.unikraft.app/api/mcp
```

## Develop

```bash
pnpm install
pnpm dev
```

Checks live in `src/lib/audit/checks.ts`. Each check is a `{ id, category, title, weight, run(ctx) }` object, so adding one is a single array entry.

## Agent runner

`lib/agent/` runs a tool-calling agent that tries a task on a site (e.g. "book a demo") and records each step.

```bash
AGENT_STUB=1 pnpm agent https://example.com "find pricing"   # fake steps, no model
pnpm agent https://example.com "book a demo"                 # needs ANTHROPIC_API_KEY
```

Env vars are listed in `.env.example`. Supabase tables: `lib/agent/schema.sql`. `lib/page.ts` is still a stub serving a fake site.

## Deploy (Unikraft Cloud)

Requires Docker and `unikraft login`.

```bash
unikraft build . --output agent-ready/agent-ready:latest
unikraft instances delete agent-ready
unikraft run --metro sfo --name agent-ready -m 1024M -p 443:3000/tls+http \
  -e HOSTNAME=0.0.0.0 -e PORT=3000 -e NODE_ENV=production \
  --image agent-ready/agent-ready:latest
```
