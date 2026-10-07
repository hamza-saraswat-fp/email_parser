-- email_parser: one run per inbound portal email, every step recorded.
-- Idempotent: safe to re-run.

create table if not exists parser_customers (
  id text primary key,
  name text not null,
  inbox_id text unique not null,
  -- Dotted paths into the universal record. "a|b" means either satisfies.
  required_fields jsonb not null default '["reference.primary","site.address.line1|site.name","work.description"]',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists parser_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text unique not null,
  inbox_id text not null,
  customer_id text references parser_customers(id),
  from_email text,
  from_name text,
  to_emails jsonb not null default '[]',
  subject text,
  text text,
  html text,
  attachments jsonb not null default '[]',
  received_at timestamptz not null default now()
);

create table if not exists parser_runs (
  id uuid primary key default gen_random_uuid(),
  email_id uuid references parser_emails(id) on delete cascade,
  customer_id text references parser_customers(id),
  status text not null default 'running'
    check (status in ('running','ready','needs_review','skipped','failed')),
  email_type text,
  portal text,
  confidence double precision,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists parser_runs_started_at_idx on parser_runs (started_at desc);

create table if not exists parser_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references parser_runs(id) on delete cascade,
  position int not null,
  name text not null,
  status text not null check (status in ('ok','skipped','failed')),
  input jsonb,
  output jsonb,
  error text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists parser_run_steps_run_idx on parser_run_steps (run_id, position);

create table if not exists parser_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid unique references parser_runs(id) on delete cascade,
  customer_id text references parser_customers(id),
  record jsonb not null,
  required_missing jsonb not null default '[]',
  created_at timestamptz not null default now()
);

insert into parser_customers (id, name, inbox_id) values
  ('dev',   'Local development', 'parser_test@agentmail.to'),
  ('demo',  'Demo account',      'parser-demo@agent.fieldpulse.com'),
  ('solis', 'Solis Lighting and Electrical Services', 'solis@agent.fieldpulse.com')
on conflict (id) do nothing;

-- Service-role only: no policies, RLS on.
alter table parser_customers enable row level security;
alter table parser_emails enable row level security;
alter table parser_runs enable row level security;
alter table parser_run_steps enable row level security;
alter table parser_records enable row level security;
