-- Agent run persistence. Run in the Supabase SQL editor.
-- Columns mirror AgentResult / AgentStep in src/lib/types.ts (snake_case).

create table if not exists agent_runs (
  run_id        uuid primary key,
  url           text not null,
  task          text not null,
  -- "running" while in progress, then a RunStatus from types.ts
  status        text not null default 'running'
                check (status in ('running', 'success', 'failed', 'blocked', 'error')),
  reason        text,
  suggested_fix text,
  step_count    integer,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists agent_steps (
  id                  bigint generated always as identity primary key,
  run_id              uuid not null references agent_runs(run_id) on delete cascade,
  n                   integer not null,
  action              text not null,
  args                jsonb not null default '{}'::jsonb,
  observation_summary text not null,
  outcome             text not null check (outcome in ('ok', 'error', 'blocked')),
  created_at          timestamptz not null default now(),
  unique (run_id, n)
);

create index if not exists agent_steps_run_id_idx on agent_steps (run_id, n);

-- The runner writes with the service role key, which bypasses RLS.
alter table agent_runs  enable row level security;
alter table agent_steps enable row level security;

-- Optional: let the frontend (anon key) read runs and subscribe to new steps live.
-- Anyone with the anon key can then read every run; fine for a hackathon demo.
-- create policy "public read runs"  on agent_runs  for select using (true);
-- create policy "public read steps" on agent_steps for select using (true);
-- alter publication supabase_realtime add table agent_runs, agent_steps;

-- Scored evaluation reports (src/lib/audit Report). One row per `pnpm evaluate` run.
create table if not exists audit_reports (
  id                bigint generated always as identity primary key,
  url               text not null,
  rubric_version    text not null,
  -- null when nothing could be evaluated (unreachable, blocked)
  score             integer check (score between 0 and 100),
  coverage          real not null,
  task_success_rate real,
  -- { "A": { "score": 80, "coverage": 0.9, ... }, ... }
  category_scores   jsonb not null,
  -- full Report JSON: checks, evidence, tasks, diagnostics
  report            jsonb not null,
  -- agent_runs.run_id for every task run that fed this report
  run_ids           uuid[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists audit_reports_url_idx on audit_reports (url, created_at desc);

alter table audit_reports enable row level security;
-- create policy "public read reports" on audit_reports for select using (true);
