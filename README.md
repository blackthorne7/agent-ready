# agent-ready

Lighthouse for AI agents. Audits any website for whether agents like Claude can **get in**, **understand it** (hours, location, menus, products, contact) and **take action** (MCP/A2A/OpenAPI endpoints, declared order/reserve actions, labeled forms), then returns a 0-100 score with copy-paste fixes.

Live: https://agentready.sfo.unikraft.app

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
claude mcp add --transport http agent-ready https://agentready.sfo.unikraft.app/api/mcp
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

**Pricing:** the score and report are free; exporting a report's fix link costs $9, paid with Stripe Checkout (`src/lib/payments.ts`, `/api/checkout`). A payment covers **one report**: its fingerprint (`src/lib/report-fingerprint.ts`, a hash of the page checks that still need fixing) is stored on the Stripe Checkout Session as `metadata.report`. Re-checking an unchanged site gives the same fingerprint, so it stays unlocked; after the owner changes something, the new report needs a new payment. `/api/fix-link` checks the paid session and fingerprint with Stripe before creating a link, so the paywall holds for direct API calls. Test mode only: set `STRIPE_SECRET_KEY=sk_test_...` (live keys are refused). Without the key, fix links stay free. The MCP `generate_fixes` tool is not gated.

### Stripe demo (test mode)

1. In the [Stripe dashboard](https://dashboard.stripe.com) turn on **Test mode** (newer accounts call it **Sandbox**), open **Developers → API keys** and copy the **Secret key** (`sk_test_...`). Put it in `.env` as `STRIPE_SECRET_KEY=sk_test_...`, no quotes or spaces.
2. `pnpm dev`, open `/report?url=python.org`, wait for the score, and click **Get my fix link · $9**.
3. Fill in Stripe Checkout with this dummy info. Nothing is charged; real card numbers are declined in test mode.

| Field | Enter |
| --- | --- |
| Email | `test@example.com` |
| Card number | `4242 4242 4242 4242` |
| Expiry | `12/34` (any future date) |
| CVC | `123` (any 3 digits) |
| Name on card | `Test User` |
| Country / ZIP | `United States` / `10001` |
| Phone (only if Stripe Link asks, or untick "Save my information") | `(201) 555-0123` |
| Link verification code (if asked) | `000000` |

4. Pay. You're sent back to the report with **Paid ✓**; **Copy my fix link** now exports. The payment shows under **Payments** in the dashboard (test mode).
5. The payment is remembered in that browser. After clearing storage or on another device, click **Already paid? Restore with your email** and enter the checkout email: the server finds that email's paid checkout for this website's current report in Stripe (`/api/checkout/restore`, 10 tries an hour per visitor). It proves knowledge of the email, not ownership of the inbox; emailing a one-time code would.

**Free next report:** after a purchase that charged money, the report shows the buyer a code (`FREE…`) for 100% off their next report: single use, only for their Stripe customer, valid 30 days (`/api/checkout/reward`, `rewardFor` in `src/lib/payments.ts`). It's created in Stripe the first time it's shown and the same code after that. A report paid with that code earns no new one. Checkouts create a Stripe customer, and a returning buyer's next checkout reuses theirs (taken from their earlier paid checkout in Stripe, not from the browser) so the code applies. The codes show up in the dashboard under **Product catalog → Coupons** as "Free next report".

**Promo codes:** checkout accepts Stripe promotion codes. Create one in the dashboard (test mode): **Product catalog → Coupons → + New** (e.g. 100% off, or $5 off), then **Add promotion code** with a code like `DEMOFREE`. On checkout click **Add promotion code** and enter it. A 100%-off code completes at $0 and still unlocks the report. See who used a code under the coupon's **Promotion codes** (redemption count) and each checkout's **Discounts**; via the API, `GET /v1/promotion_codes?code=DEMOFREE` returns `times_redeemed`.

Other test cards:

| Card | Result |
| --- | --- |
| `4000 0000 0000 0002` | Declined; the fix link stays locked |
| `4000 0025 0000 3155` | Asks for 3-D Secure; approve it to pay |
| `4000 0000 0000 9995` | Declined for insufficient funds |

Locally the fix link itself is stored in Supabase, so exporting after paying needs the Supabase vars in `.env` too.

Env vars are listed in `.env.example`. Supabase tables: `supabase/schema.sql` (audits, fix links, leaderboard) and `lib/agent/schema.sql` (`agent_runs`, `agent_steps`, `audit_reports`). Every audit from the web, API or MCP is saved when `SUPABASE_SERVICE_ROLE_KEY` is set.

## Deploy (Unikraft Cloud)

**Merging to `main` deploys automatically** (`.github/workflows/deploy.yml`): it runs the unit tests, builds the image, swaps it onto the live `agent-ready` instance and checks the site. Only the image changes; the instance's env vars are kept. It needs the `UNIKRAFT_TOKEN` repository secret and the `UNIKRAFT_ORG`, `UNIKRAFT_INSTANCE` (`agent-ready`) and `UNIKRAFT_SERVICE` (`agentready`, which sets the URL) repository variables. If the instance doesn't exist yet, the first run creates the service and the instance, taking its env vars from the repository secrets of the same names as in `.env`. It can be re-run from the Actions tab ("Run workflow"). Pull requests get tests and a production build first (`ci.yml`).

To add or change an env var, stop the instance, edit, start (see below). The manual steps are for first-time setup or when Actions is down. Requires Docker and `unikraft login`.

Deploys attach to the existing `agentready` service so the URL never changes. Supabase env is read from `.env` (it isn't baked into the image).

```bash
unikraft build . --output agent-ready/agent-ready:latest
unikraft instances delete agent-ready
set -a && . ./.env && set +a
unikraft run --metro sfo --name agent-ready -m 1024M --set service=agentready \
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
  -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  -e SITE_URL=https://agentready.sfo.unikraft.app \
  --image agent-ready/agent-ready:latest
```

To add the paywall to the instance that's already running, without dropping its other env vars:

```bash
unikraft instances stop agent-ready
unikraft instances edit agent-ready --add runtime.env=STRIPE_SECRET_KEY=sk_test_...
unikraft instances edit agent-ready --add runtime.env=SITE_URL=https://agentready.sfo.unikraft.app
unikraft instances start agent-ready
```

`.env` must have the Supabase, `OMNARA_*` and Context.dev (`CONTEXT_DEV_API_KEY`, `LOGOLINK_CLIENT_ID`) vars; see `.env.example`. Nothing errors if one is missing: without the Omnara vars the agent section fails, and without the Context.dev ones logos disappear and categories and fix plans fall back to keywords and TODOs. Instance env vars can't be added later with `-e` (that replaces the whole env); use `unikraft instances edit agent-ready --add runtime.env=KEY=value` instead. Edits to env or image only take effect while the instance is stopped: `unikraft instances stop agent-ready`, edit, then `unikraft instances start agent-ready`.

If `instances delete agent-ready` reports "not found", run `unikraft instances list` and delete whatever is on `agentready` by its UUID.
