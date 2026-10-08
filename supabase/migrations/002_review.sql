-- Review queue: a person approves or rejects a run. Idempotent.
alter table parser_runs drop constraint if exists parser_runs_status_check;
alter table parser_runs add constraint parser_runs_status_check
  check (status in ('running','ready','needs_review','skipped','failed','approved','rejected'));
alter table parser_runs add column if not exists reviewed_by text;
alter table parser_runs add column if not exists reviewed_at timestamptz;
alter table parser_runs add column if not exists review_note text;
