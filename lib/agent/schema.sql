-- Agent run persistence. Run in the Supabase SQL editor.
-- Columns mirror AgentResult / AgentStep in lib/types.ts (snake_case).

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
