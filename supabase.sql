-- Execute uma vez no SQL Editor do seu projeto Supabase.
create table public.attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer check (score between 0 and 75),
  total integer not null default 75 check (total = 75),
  state jsonb not null,
  constraint valid_completion check (
    (finished_at is null and score is null) or
    (finished_at is not null and score is not null)
  )
);
create index attempts_user_started on public.attempts(user_id, started_at desc);
alter table public.attempts enable row level security;
revoke all on public.attempts from anon;
grant select, insert, update on public.attempts to authenticated;
create policy "Read own attempts" on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own attempts" on public.attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own attempts" on public.attempts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
