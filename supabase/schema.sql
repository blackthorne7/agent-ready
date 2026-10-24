-- Agent Ready: data model for reports, fix links and the leaderboard.
-- Run in the Supabase SQL editor. Agent run tables live separately in lib/agent/schema.sql.
--
--   business_types   lookup: restaurant, auto shop, salon, ...
--   businesses       one row per website (domain), with type and location
--   audits           every score we ever ran (history, so owners can see progress)
--   fix_links        the "one link" a business pastes into Wix / Lovable / Claude
--   leaderboard      view: latest score per business, ranked global / by type / local


-- 1. Business types ---------------------------------------------------------
-- A table instead of an enum so adding a type is an insert, not a migration.

create table if not exists business_types (
  slug  text primary key,          -- 'restaurant'
  label text not null              -- 'Restaurant'
);

insert into business_types (slug, label) values
  ('restaurant', 'Restaurant'),
  ('cafe',       'Cafe & Bakery'),
  ('auto_shop',  'Auto Shop'),
  ('salon',      'Salon & Barber'),
  ('clinic',     'Clinic & Dental'),
  ('gym',        'Gym & Fitness'),
  ('retail',     'Retail Store'),
  ('home',       'Home Services'),  -- plumbers, electricians, cleaners
  ('tech',       'Tech & Software'),
  ('media',      'Media & News'),
  ('government', 'Government & Nonprofit'),
  ('other',      'Other')
on conflict (slug) do nothing;


-- 2. Businesses -------------------------------------------------------------
-- One row per website. Type and location come from the site's JSON-LD when it
-- has it (@type Restaurant, address), otherwise the owner picks them.

create table if not exists businesses (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null unique,              -- 'joespizza.com' (no www, no path)
  name          text,                              -- "Joe's Pizza"
  business_type text not null default 'other' references business_types(slug),
  city          text,                              -- 'Austin'
  region        text,                              -- 'TX'
  country       text,                              -- 'US' (ISO 3166-1 alpha-2)
  listed        boolean not null default true,     -- false = hidden from the leaderboard
  created_at    timestamptz not null default now()
);

create index if not exists businesses_type_idx     on businesses (business_type);
create index if not exists businesses_location_idx on businesses (country, region, city);


-- 3. Audits -----------------------------------------------------------------
-- Every run of the audit engine (src/lib/audit). Mirrors the Report type.
-- Never updated: re-checking a site adds a new row, so we keep the history.

create table if not exists audits (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  url              text not null,                  -- exact URL audited
  status           text not null default 'evaluated' check (status in ('evaluated', 'blocked')),
  score            integer check (score between 0 and 100),  -- null only when blocked
  grade            text check (grade in ('A', 'B', 'C', 'D', 'F')),
  access_score     integer,                        -- "Can agents get in?"
  understand_score integer,                        -- "Can agents understand it?"
  act_score        integer,                        -- "Can agents take action?"
  checks           jsonb not null default '[]',    -- CheckResult[] from the audit
  tasks            jsonb not null default '[]',    -- TaskRun[]: the AI agent's task results
  error            text,                           -- set when the site couldn't be loaded
  audited_at       timestamptz not null default now()
);

create index if not exists audits_business_idx on audits (business_id, audited_at desc);

-- Added after launch: blocked sites (a bot wall turned our checker away) are saved with no score,
-- so the leaderboard can list them as blocked. Safe to re-run.
alter table audits add column if not exists status text not null default 'evaluated';
alter table audits alter column score            drop not null;
alter table audits alter column grade            drop not null;
alter table audits alter column access_score     drop not null;
alter table audits alter column understand_score drop not null;
alter table audits alter column act_score        drop not null;
alter table audits drop constraint if exists audits_status_check;
alter table audits add constraint audits_status_check
  check (status in ('evaluated', 'blocked') and (status = 'blocked') = (score is null));


-- 4. Fix links --------------------------------------------------------------
-- The one link from the brief: /fix/<slug>. Its page shows the plain-language
-- report plus the copy-paste fixes, readable by a person or by a site builder's AI.

create table if not exists fix_links (
  slug         text primary key,                   -- short random id, e.g. 'k3h9x2'
  audit_id     uuid not null references audits(id) on delete cascade,
  llms_txt     text,                               -- Fixes from src/lib/audit/fixes.ts
  json_ld      text,
  robots_txt   text,
  mcp_manifest text,
  created_at   timestamptz not null default now()
);


-- 5. Leaderboard ------------------------------------------------------------
-- Latest successful audit per listed business, with four rankings (null for blocked sites,
-- which have no score and are listed separately):
--   global_rank      everyone
--   type_rank        e.g. best restaurants anywhere
--   local_rank       everyone in the same city
--   local_type_rank  e.g. best auto shops in Austin, TX

-- Dropped first: create or replace can't change a view's columns.
drop view if exists leaderboard;
create view leaderboard
with (security_invoker = true) as
with latest as (
  select distinct on (business_id) *
  from audits
  where error is null
  order by business_id, audited_at desc
)
select
  b.domain,
  b.name,
  b.business_type,
  b.city,
  b.region,
  b.country,
  l.score,
  l.grade,
  l.access_score,
  l.understand_score,
  l.act_score,
  l.audited_at,
  l.status,
  -- nulls last: Postgres sorts nulls first in descending order, which would rank blocked sites #1.
  case when l.score is not null then rank() over (order by l.score desc nulls last) end                                                        as global_rank,
  case when l.score is not null then rank() over (partition by b.business_type order by l.score desc nulls last) end                           as type_rank,
  case when l.score is not null then rank() over (partition by b.country, b.region, b.city order by l.score desc nulls last) end               as local_rank,
  case when l.score is not null then rank() over (partition by b.country, b.region, b.city, b.business_type order by l.score desc nulls last) end as local_type_rank
from latest l
join businesses b on b.id = l.business_id
where b.listed;


-- 6. Access -----------------------------------------------------------------
-- The server writes with the secret key, which bypasses RLS.
-- The public (publishable key) can only read.

alter table business_types enable row level security;
alter table businesses     enable row level security;
alter table audits         enable row level security;
alter table fix_links      enable row level security;

-- Dropped first so this file can be re-run.
drop policy if exists "public read types"      on business_types;
drop policy if exists "public read businesses" on businesses;
drop policy if exists "public read audits"     on audits;
drop policy if exists "public read fix links"  on fix_links;

create policy "public read types"      on business_types for select using (true);
create policy "public read businesses" on businesses     for select using (listed);
-- Opting out (listed = false) hides a business's audits too.
create policy "public read audits"     on audits         for select
  using (exists (select 1 from businesses b where b.id = business_id and b.listed));
-- Fix content is generated from public pages, so a guessable slug leaks nothing private.
create policy "public read fix links"  on fix_links      for select using (true);


-- Example queries ------------------------------------------------------------
--
-- Global top 10:
--   select * from leaderboard order by global_rank limit 10;
--
-- Best restaurants anywhere:
--   select * from leaderboard where business_type = 'restaurant' order by type_rank limit 10;
--
-- Best auto shops in Austin, TX:
--   select * from leaderboard
--   where country = 'US' and region = 'TX' and city = 'Austin' and business_type = 'auto_shop'
--   order by local_type_rank limit 10;
--
-- A business's score over time:
--   select audited_at, score from audits a join businesses b on b.id = a.business_id
--   where b.domain = 'joespizza.com' order by audited_at;

-- Added after launch: run on existing databases.
alter table audits add column if not exists tasks jsonb not null default '[]';
