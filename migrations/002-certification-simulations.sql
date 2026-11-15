-- Execute no SQL Editor do Supabase antes de sincronizar os novos simulados
-- de CIS-EM (30 questões) e CAD (60 questões) em um projeto já configurado.
-- Pode ser repetido. Preserva registros, políticas RLS e o padrão legado de 75.
begin;

alter table public.attempts
  drop constraint if exists attempts_total_check,
  drop constraint if exists attempts_score_check;

alter table public.attempts
  add constraint attempts_total_check check (total in (30, 60, 75)),
  add constraint attempts_score_check check (score >= 0 and score <= total);

commit;
