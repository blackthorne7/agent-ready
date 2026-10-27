# One final score per check

Every website check shows **one score**, and it is saved **once**. That score is the final one: the 6-category rubric *including* the AI agent's task results.

## Why

The rubric has an area ("Can AI finish tasks for customers?") that only the AI agent can measure. A checklist-only score skips it, so it is a different, partial number. Showing it first and then the agent's score made the score jump (e.g. 78, then 84) and saved two scores per site.

## How the report page works now

```
/report?url=…
  1. loading.tsx             AgentEvaluationProgress (stage="checklist") while the server runs the checklist (a few seconds)
  2. page.tsx                runAudit(url). Checklist only. NOT saved, NOT shown.
  3. report-body.tsx         Calls /api/agent; shows AgentEvaluationProgress (stage="agent") until it answers (~1 min)
  4. /api/agent              Agent tries 3 tasks → runAudit(url, { tasks }) → saveAudit()   ← the ONLY save
  5. report-body.tsx         Shows the final report: score, fix link, top fixes, what's working
```

| File | Role |
| --- | --- |
| `src/app/report/page.tsx` | Runs the checklist for errors/blocked sites and as a fallback. Doesn't save. |
| `src/app/report/report-body.tsx` | Holds everything behind the progress card until the final report arrives. |
| `src/app/api/agent/route.ts` | Runs the agent, re-scores, saves. If the agent throws, or the day's agent budget (`AGENT_DAILY_BUDGET`, default 50) is used up, it still scores and saves once, without task results; a used-up budget is flagged `agentSkipped: "daily_limit"` and the verdict card says so. With `blocked: true` it records a bot-walled site instead (see below). |
| `src/app/report/blocked-report.tsx` | The report for a site that blocked our checker: no score, how to unblock, and how owners let our checker in. |
| `src/app/report/AgentEvaluationProgress.tsx` | The loading card (`stage="checklist"` in `loading.tsx`, `stage="agent"` in `report-body.tsx`). Its messages rotate on a timer. |

## Rules for changes

- **Don't render a score before the final report.** Anything shown while waiting goes in `AgentEvaluationProgress`.
- **Don't call `saveAudit` from the report page.** `/api/agent` is the only place the report flow saves.
- **If the agent didn't run, say so.** The verdict card then says "AI task test didn't run…". Don't swap in a second number later.
- **Fix link:** `/api/fix-link` builds the plan from the latest *saved* audit, so it only works after `/api/agent` has saved. The button only appears with the final report, so this holds.

## Blocked sites

A site that turns our checker away (bot wall, 403) gets **no score**: we only score what agents can see, and we never get around the block. The report page shows `BlockedReport`, which asks `/api/agent` with `blocked: true` to record it. The server re-checks the block itself, skips the agent, and saves a row with `status = 'blocked'` and no score (at most once an hour per site). The leaderboard lists these unranked under "Blocking AI assistants", and fix links refuse them.

## Still open

- `/api/audit` and the MCP `audit_site` tool still save checklist-only scores. Leaderboard rows from those are partial scores. Decide whether they should save at all.
- If the `/api/agent` HTTP request itself fails (timeout, network) or returns no score, the page falls back to the unsaved checklist score, labelled as checklist-only, and hides the fix link for that run.
- The HTML report needs JavaScript (the browser starts the agent run). Clients without JS get a `<noscript>` pointer to `/api/audit`; `llms.txt` says so.
- Going Back from the fix page re-runs the whole check (the report page isn't cached). Fix: after the final report arrives, put the audit id in the URL and serve the saved audit.
- The progress card is time-based, not driven by real agent events. Streaming real stages from `/api/agent` into `AgentEvaluationProgress` is the next step.
