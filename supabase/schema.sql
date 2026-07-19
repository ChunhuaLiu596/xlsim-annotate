-- ============================================================
-- XLSim annotation — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- ============================================================

-- One row per cell judgment: this is the analysis table for IAA.
create table if not exists annotations (
  id          bigint generated always as identity primary key,
  prolific_pid text not null,
  cue_id      text not null,
  row_word    text not null,
  col_word    text not null,
  score       real not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_annotations_pid on annotations (prolific_pid);
create index if not exists idx_annotations_cue on annotations (cue_id);

-- One row per participant session: finish time + QC fields.
create table if not exists sessions (
  prolific_pid   text primary key,
  study_id       text,
  session_id     text,
  started_at     timestamptz,
  finished_at    timestamptz,
  gold_pass      boolean,
  active_ms      bigint,
  completion_code text
);
alter table sessions add column if not exists dataset_batch text;

-- One row per participant: demographic questionnaire (Prolific project 34544).
create table if not exists demographics (
  prolific_pid       text primary key,
  nationality         text,
  postcode             text,
  occupation           text,
  age                  int,
  gender               text,
  gender_other         text,
  education            text,
  native_language      text,
  translation_experience text,          -- no | occasional | regular | full_time
  translation_types     jsonb,          -- ["written","spoken","subtitling","localisation","other"]
  translation_types_other text,
  translation_years     text,           -- <1 | 1-3 | 4-7 | 7+
  submitted_at         timestamptz not null default now()
);

-- Keep existing deployments in sync when this schema is run again.
alter table demographics add column if not exists native_language text;

-- One row per participant: end-of-study feedback questionnaire.
create table if not exists feedback (
  prolific_pid   text primary key,
  interest       int,   -- 1-10, how interesting they found the task
  difficulty     int,   -- 1-10, how difficult they found the task
  difficulty_where text, -- optional free text
  motivation     int,   -- 1-10, how motivated they were
  suggestions    text,  -- optional free text
  submitted_at   timestamptz not null default now()
);

-- ============================================================
-- CUE PAIRS — the full pool of matrices to annotate.
-- Replaces the static CUE_PAIRS array in src/taskData.js: load pairs
-- here once (see scripts/load_cue_pairs.py), then annotators are handed
-- a slice of this pool at runtime instead of all of them at build time.
-- ============================================================
create table if not exists cue_pairs (
  id            text primary key,        -- e.g. "chuzuche_taxi"
  cue_l1        jsonb not null,          -- {w:"出租车", lang:"zh"}
  cue_l2        jsonb not null,          -- {w:"taxi", lang:"en"}
  cols          jsonb not null,          -- ["taxi","cab",...]
  rows          jsonb not null,          -- [{w:"出租车",gloss:"..."}, ...]
  gold          jsonb not null default '[]',
  target_labels int not null default 3,  -- how many annotators should see this pair
  created_at    timestamptz not null default now()
);
alter table cue_pairs add column if not exists dataset_batch text not null default 'production';
create index if not exists idx_cue_pairs_dataset_batch on cue_pairs (dataset_batch);

-- One row per (participant, cue_pair): which pairs a PID was handed, and
-- when. Assigning once and recording it means a page refresh mid-session
-- doesn't reshuffle their matrix list.
create table if not exists assignments (
  prolific_pid text not null,
  cue_id       text not null references cue_pairs (id),
  assigned_at  timestamptz not null default now(),
  primary key (prolific_pid, cue_id)
);
create index if not exists idx_assignments_cue on assignments (cue_id);

-- ============================================================
-- ASSIGNMENT FUNCTION — Potato-style live allocation.
-- Picks the `n` cue pairs with the fewest completed annotators so far
-- (self-balancing overlap), assigns them to `p_pid` if not already
-- assigned, and returns that participant's full assigned set.
-- SECURITY DEFINER: runs as the function owner (bypasses caller's RLS)
-- so the anon role can read cue_pairs/assignments through this one
-- controlled entry point without a blanket select policy.
-- ============================================================
drop function if exists assign_cue_pairs(text, int);
drop function if exists assign_cue_pairs(text, int, text);

create or replace function assign_cue_pairs(
  p_pid text,
  n int default 5,
  p_language text default null,
  p_dataset_batch text default 'pilot'
)
returns setof cue_pairs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- First call for this PID: pick the most under-covered pairs.
  if not exists (
    select 1
    from assignments existing
    join cue_pairs existing_pair on existing_pair.id = existing.cue_id
    where existing.prolific_pid = p_pid
      and (
        p_language is null
        or existing_pair.cue_l1->>'lang' = p_language
        or existing_pair.cue_l2->>'lang' = p_language
      )
      and existing_pair.dataset_batch = p_dataset_batch
  ) then
    insert into assignments (prolific_pid, cue_id)
    select p_pid, cp.id
    from cue_pairs cp
    left join (
      select cue_id, count(distinct prolific_pid) as n_done
      from assignments
      group by cue_id
    ) done on done.cue_id = cp.id
    where coalesce(done.n_done, 0) < cp.target_labels
      and cp.dataset_batch = p_dataset_batch
      and (
        p_language is null
        or cp.cue_l1->>'lang' = p_language
        or cp.cue_l2->>'lang' = p_language
      )
    order by coalesce(done.n_done, 0) asc, random()
    limit n;
  end if;

  return query
    select cp.*
    from cue_pairs cp
    join assignments a on a.cue_id = cp.id
    where a.prolific_pid = p_pid
      and cp.dataset_batch = p_dataset_batch
      and (
        p_language is null
        or cp.cue_l1->>'lang' = p_language
        or cp.cue_l2->>'lang' = p_language
      )
    order by cp.id;
end;
$$;

-- ============================================================
-- ROW-LEVEL SECURITY  — this is the security boundary.
-- The anon key is public (it ships in the browser bundle), so we
-- MUST allow inserts but forbid reading the table from the client.
-- You read data via the service_role key server-side / in the
-- Supabase dashboard, which bypasses RLS.
-- ============================================================
alter table annotations enable row level security;
alter table sessions    enable row level security;
alter table cue_pairs   enable row level security;
alter table assignments enable row level security;
alter table demographics enable row level security;
alter table feedback    enable row level security;

-- Allow anonymous INSERTs (participants writing their own data)…
drop policy if exists "anon insert annotations" on annotations;
create policy "anon insert annotations"
  on annotations for insert to anon with check (true);

drop policy if exists "anon insert sessions" on sessions;
create policy "anon insert sessions"
  on sessions for insert to anon with check (true);

-- …allow the session UPSERT/UPDATE on finish…
drop policy if exists "anon update sessions" on sessions;
create policy "anon update sessions"
  on sessions for update to anon using (true) with check (true);

-- Demographics is a single upsert per participant (insert-or-update on submit).
drop policy if exists "anon insert demographics" on demographics;
create policy "anon insert demographics"
  on demographics for insert to anon with check (true);

drop policy if exists "anon update demographics" on demographics;
create policy "anon update demographics"
  on demographics for update to anon using (true) with check (true);

-- Feedback is a single upsert per participant (insert-or-update on submit).
drop policy if exists "anon insert feedback" on feedback;
create policy "anon insert feedback"
  on feedback for insert to anon with check (true);

drop policy if exists "anon update feedback" on feedback;
create policy "anon update feedback"
  on feedback for update to anon using (true) with check (true);

-- NO select policy for anon on annotations/sessions → clients cannot read
-- anyone's rows (including their own). Reads happen in the dashboard
-- or via service_role only. This is intentional.

-- cue_pairs / assignments: no direct anon select or insert policy at all.
-- The anon role reaches both ONLY through assign_cue_pairs(), which is
-- SECURITY DEFINER and does its own row selection server-side — this
-- avoids a broad "anon can read all assignments" policy that would let
-- one participant enumerate other PIDs.
grant execute on function assign_cue_pairs(text, int, text, text) to anon;
