-- Execute no SQL Editor do Supabase. Não altera a tabela dos simulados.
begin;
create table if not exists public.study_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  total integer not null check (total > 0),
  state jsonb not null,
  constraint study_score_valid check (score >= 0 and score <= total),
  constraint study_completion_valid check (
    (finished_at is null and score is null) or
    (finished_at is not null and score is not null)
  )
);
create index if not exists study_sessions_user_started on public.study_sessions(user_id, started_at desc);
alter table public.study_sessions enable row level security;
revoke all on public.study_sessions from anon;
grant select, insert, update on public.study_sessions to authenticated;
drop policy if exists "Read own study" on public.study_sessions;
create policy "Read own study" on public.study_sessions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Create own study" on public.study_sessions;
create policy "Create own study" on public.study_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own study" on public.study_sessions;
create policy "Update own study" on public.study_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
commit;
