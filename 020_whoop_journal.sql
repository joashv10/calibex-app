-- WHOOP's old journal export (journal_entries.csv), one row per cycle x question. Additive:
-- the journal table was empty. wake_date is the wake_date of the SAME cycle in `cycles`
-- (matched on cycle_start), so it joins like every other table. Re-runs are no-ops.
alter table public.journal
  add column if not exists cycle_start timestamptz,
  add column if not exists cycle_end   timestamptz,
  add column if not exists cycle_tz    text,
  add column if not exists question    text,
  add column if not exists answered_yes boolean,
  add column if not exists notes       text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'journal_cycle_question_key') then
    alter table public.journal add constraint journal_cycle_question_key unique (cycle_start, question);
  end if;
end $$;
-- Owner lock, same shape as cycles_owner_read (RLS was already on, with no policy).
drop policy if exists journal_owner_read on public.journal;
create policy journal_owner_read on public.journal for select to authenticated
  using ((select private.is_owner()));
