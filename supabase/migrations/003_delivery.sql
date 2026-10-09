-- FieldPulse delivery: one row per job we created (or found) in FieldPulse. Idempotent.
create table if not exists parser_deliveries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references parser_runs(id) on delete cascade,
  customer_id text references parser_customers(id),
  reference text not null,
  status text not null check (status in ('delivered','failed')),
  fp_customer_id bigint,
  fp_location_id bigint,
  fp_job_id bigint,
  fp_job_cuid text,
  created_customer boolean not null default false,
  created_location boolean not null default false,
  request jsonb,
  response jsonb,
  error text,
  created_at timestamptz not null default now()
);
-- A reference number is delivered at most once per customer.
create unique index if not exists parser_deliveries_once_idx on parser_deliveries (customer_id, reference) where status = 'delivered';
create index if not exists parser_deliveries_run_idx on parser_deliveries (run_id);
alter table parser_deliveries enable row level security;

alter table parser_runs drop constraint if exists parser_runs_status_check;
alter table parser_runs add constraint parser_runs_status_check
  check (status in ('running','ready','needs_review','skipped','failed','approved','rejected','delivering','delivered','delivery_failed'));

alter table parser_customers add column if not exists fp_custom_fields jsonb;
