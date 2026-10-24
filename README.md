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
- **Leaderboard:** `/leaderboard`, filter by `?type=restaurant` (location filter paused)
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

### Live evaluation progress demo

Start the development server and open `/report?url=example.com&demo=1` to preview the waiting experience:

```bash
pnpm install
pnpm dev
```

Then visit `http://localhost:3000/report?url=example.com&demo=1`. The demo displays three evaluation stages at a time, greys out completed stages, rotates the friendly status messages, and exposes simulated technical details through the **Details** buttons. The progress UI is in `src/app/report/AgentEvaluationProgress.tsx` and is shown at the top by `src/app/report/loading.tsx` while the existing report is generated; the score and result graph remain separate.

## Agent runner

`lib/agent/` runs a tool-calling agent that tries a task on a site (e.g. "book a demo") and records each step.

```bash
AGENT_STUB=1 pnpm agent https://example.com "find pricing"   # fake steps, no model
pnpm agent https://example.com "book a demo"                 # AGENT_RUNTIME=omnara: needs OMNARA_* vars
```

With `AGENT_RUNTIME=omnara`, [Omnara](https://docs.omnara.com) runs the agent loop and model, and our tools (`lib/agent/tools.ts`) run as Omnara custom tools on our server. Each run logs a dashboard link. Without it, `lib/agent/model.ts` calls Claude directly (needs `ANTHROPIC_API_KEY`). Both share the guardrails in `lib/agent/guard.ts`. The agent reads real pages through `lib/page.ts`; `AGENT_FAKE_SITE=1` swaps in the fake site in `lib/page-fake.ts`.

Env vars are listed in `.env.example`. Supabase tables: `supabase/schema.sql` (audits, fix links, leaderboard) and `lib/agent/schema.sql` (`agent_runs`, `agent_steps`, `audit_reports`). Every audit from the web, API or MCP is saved when `SUPABASE_SERVICE_ROLE_KEY` is set.

## Deploy (Unikraft Cloud)

Requires Docker and `unikraft login`.

Deploys attach to the existing `snowy-thunder-epw3bj03` service so the URL never changes. Supabase env is read from `.env` (it isn't baked into the image).

```bash
unikraft build . --output agent-ready/agent-ready:latest
unikraft instances delete agent-ready
set -a && . ./.env && set +a
unikraft run --metro sfo --name agent-ready -m 1024M --set service=snowy-thunder-epw3bj03 \
  -e HOSTNAME=0.0.0.0 -e PORT=3000 -e NODE_ENV=production \
  -e SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -e AGENT_RUNTIME=omnara \
  -e OMNARA_TOKEN="$OMNARA_TOKEN" \
  -e OMNARA_ORG_ID="$OMNARA_ORG_ID" \
  -e OMNARA_PROJECT_ID="$OMNARA_PROJECT_ID" \
  -e OMNARA_MODEL="${OMNARA_MODEL:-anthropic/claude-sonnet-5.5}" \
  -e CONTEXT_DEV_API_KEY="$CONTEXT_DEV_API_KEY" \
  -e LOGOLINK_CLIENT_ID="$LOGOLINK_CLIENT_ID" \
  --image agent-ready/agent-ready:latest
```

`.env` must have the Supabase, `OMNARA_*` and Context.dev (`CONTEXT_DEV_API_KEY`, `LOGOLINK_CLIENT_ID`) vars; see `.env.example`. Nothing errors if one is missing: without the Omnara vars the agent section fails, and without the Context.dev ones logos disappear and categories and fix plans fall back to keywords and TODOs. Instance env vars can't be added later with `-e` (that replaces the whole env); use `unikraft instances edit agent-ready --add runtime.env=KEY=value` instead. Edits to env or image only take effect while the instance is stopped: `unikraft instances stop agent-ready`, edit, then `unikraft instances start agent-ready`.

If `instances delete agent-ready` reports "not found", run `unikraft instances list` and delete whatever is on `snowy-thunder` by its UUID.
