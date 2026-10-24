# agent-ready

Lighthouse for AI agents. Audits any website for whether agents like Claude can **get in**, **understand it** (hours, location, menus, products, contact) and **take action** (MCP/A2A/OpenAPI endpoints, declared order/reserve actions, labeled forms), then returns a 0-100 score with copy-paste fixes.

Live: https://snowy-thunder-epw3bj03.sfo.unikraft.app

Problem and solution: [docs/problem-solution.md](docs/problem-solution.md)

## Landing page designs

Three directions to choose from, side by side on one canvas: https://claude.ai/artifact/MyR1WrJvLrYYwqL5TDRjd9

- **A · Main Street:** warm and local. An AI chat skips a restaurant whose menu it can't read.
- **B · Report Card:** led by the score. A big score ring and three plain-English questions.
- **C · The Conversation:** dark and story-led. "That 'sorry' is a lost customer."

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

Checks live in `src/lib/audit/checks.ts`, one entry per line of `evals/AGENT_CHECKS.md`. Each is a `{ id, category, title, weight, method, run(ctx) }` object, so adding one is a single array entry.

- **Categories** A–F and their weights (15/20/25/15/15/10) are in `src/lib/audit/rubric.ts`.
- **Ratings** are 0–4, or `na` (doesn't apply) or `unknown` (not measured). Unknown lowers coverage, never the score.
- **Methods:** `code` checks read the HTML; `task` checks use agent runs; `browser` checks have no `run()` yet and need Playwright.
- **Score** = Σ(weight × rating/4) / Σweight per category, then categories weighted together. A category counts only once 25% of it is measured. Bot-walled sites get no score.

```bash
pnpm test                                       # scoring + check unit tests
AGENT_STUB=1 pnpm evaluate https://example.com  # agent tasks + audit, saves reports/*.json
```

## Agent runner

`lib/agent/` runs a tool-calling agent that tries a task on a site (e.g. "book a demo") and records each step.

```bash
AGENT_STUB=1 pnpm agent https://example.com "find pricing"   # fake steps, no model
pnpm agent https://example.com "book a demo"                 # needs ANTHROPIC_API_KEY
```

Env vars are listed in `.env.example`. Supabase tables: `lib/agent/schema.sql` (`agent_runs`, `agent_steps`, `audit_reports`). `lib/page.ts` is still a stub serving a fake site, so task results don't reflect the real URL yet.

## Deploy (Unikraft Cloud)

Requires Docker and `unikraft login`.

```bash
unikraft build . --output agent-ready/agent-ready:latest
unikraft instances delete agent-ready
unikraft run --metro sfo --name agent-ready -m 1024M -p 443:3000/tls+http \
  -e HOSTNAME=0.0.0.0 -e PORT=3000 -e NODE_ENV=production \
  --image agent-ready/agent-ready:latest
```
