-- Atlas Invest AI — initial schema.
-- Access model:
--   * The application connects as the database owner and, for every user-scoped
--     request, runs inside a transaction with `SET LOCAL ROLE atlas_app` and
--     `app.user_id` set. Row-level security on every user-owned table restricts
--     rows to that user, so a bug in a query cannot leak another user's data.
--   * System jobs (market data ingestion, scheduler) run as the owner and touch
--     only shared catalog tables; per-user monitoring re-enters the user context.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'atlas_app') then
    create role atlas_app nologin;
  end if;
end $$;

create or replace function app_current_user() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────────────────────── Identity ─────────────────────────
create table users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key, -- sha256 of the session token
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

create table investment_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  answers jsonb not null,
  derived jsonb not null,
  base_currency text not null check (base_currency in ('BRL','USD')),
  methodology_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  notifications jsonb not null default '{}'::jsonb,
  thresholds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Market data (shared catalog) ─────────────────────────
create table data_sources (
  id text primary key,
  name text not null,
  kind text not null,          -- macro | prices | crypto | events | demo
  is_demo boolean not null default false,
  url text,
  license_note text,
  configured boolean not null default false,
  status text not null default 'never', -- never | ok | error | disabled
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);

create table assets (
  id text primary key,
  symbol text not null,
  name text not null,
  asset_class text not null,
  market text not null,
  currency text not null,
  issuer text not null,
  sector text not null,
  country text not null,
  spec jsonb not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table asset_prices (
  asset_id text not null references assets(id) on delete cascade,
  date date not null,
  close double precision not null,
  source_id text not null references data_sources(id),
  is_demo boolean not null,
  fetched_at timestamptz not null default now(),
  primary key (asset_id, is_demo, date)
);
create index asset_prices_latest_idx on asset_prices(asset_id, is_demo, date desc);

create table macro_indicators (
  code text not null,          -- CDI | SELIC | IPCA12M | USDBRL | UST3M | UST10Y
  date date not null,
  value double precision not null,
  source_id text not null references data_sources(id),
  is_demo boolean not null,
  fetched_at timestamptz not null default now(),
  primary key (code, is_demo, date)
);

create table market_events (
  id uuid primary key,
  asset_id text references assets(id) on delete cascade,
  event_type text not null,    -- credit | regulatory | liquidity | counterparty | fundamentals | crypto
  severity text not null check (severity in ('info','attention','critical')),
  title text not null,
  description text not null,
  occurred_at timestamptz not null,
  source_id text not null references data_sources(id),
  is_demo boolean not null,
  created_at timestamptz not null default now()
);

create table risk_metrics (
  asset_id text not null references assets(id) on delete cascade,
  base_currency text not null,
  methodology_version text not null,
  data_as_of date,
  computed_at timestamptz not null default now(),
  score int not null,
  category text not null,
  components jsonb not null,
  metrics jsonb not null,
  limitations jsonb not null,
  is_demo_data boolean not null,
  primary key (asset_id, base_currency, methodology_version, computed_at)
);

-- ───────────────────────── Portfolios ─────────────────────────
create table portfolios (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text not null default '',
  base_currency text not null,
  strategy text not null default 'custom',
  source_recommendation_id uuid,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portfolios_user_idx on portfolios(user_id);

create table positions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id text not null references assets(id),
  quantity double precision not null check (quantity >= 0),
  avg_price double precision not null check (avg_price >= 0),
  acquired_at date not null,
  origin text not null check (origin in ('manual','imported')),
  manual_value double precision,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index positions_portfolio_idx on positions(portfolio_id);

create table target_allocations (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id text not null references assets(id),
  weight double precision not null check (weight >= 0 and weight <= 1),
  rationale text not null default '',
  unique (portfolio_id, asset_id)
);

-- ───────────────────────── Recommendations & evidence ─────────────────────────
create table recommendations (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid references portfolios(id) on delete set null,
  kind text not null,          -- portfolio_proposal | agent_report | opportunity_scan
  title text not null,
  summary text not null,
  body jsonb not null,
  confidence text not null check (confidence in ('baixa','média','alta')),
  confidence_score int not null,
  methodology_versions jsonb not null,
  data_as_of timestamptz,
  uses_demo_data boolean not null,
  generator text not null,     -- rules | anthropic:<model>
  created_at timestamptz not null default now()
);
create index recommendations_user_idx on recommendations(user_id, created_at desc);

create table recommendation_evidence (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  label text not null,
  value jsonb not null,
  source text not null,
  data_as_of text,
  is_demo boolean not null default false
);
create index recommendation_evidence_rec_idx on recommendation_evidence(recommendation_id);

-- ───────────────────────── Monitoring ─────────────────────────
create table monitoring_runs (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  trigger text not null check (trigger in ('manual','scheduled','api')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running', -- running | ok | partial | error
  market_status jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  alerts_created int not null default 0,
  alerts_suppressed int not null default 0,
  rules_version text not null
);
create index monitoring_runs_user_idx on monitoring_runs(user_id, started_at desc);

create table monitoring_snapshots (
  run_id uuid not null references monitoring_runs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id text not null,
  price double precision,
  price_date date,
  value_base double precision not null,
  weight double precision not null,
  risk_score int not null,
  risk_category text not null,
  data_status text not null,
  primary key (run_id, portfolio_id, asset_id)
);

create table portfolio_snapshots (
  run_id uuid not null references monitoring_runs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  total_value double precision not null,
  risk_score int not null,
  macro jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, portfolio_id)
);

create table alerts (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  portfolio_id uuid references portfolios(id) on delete cascade,
  run_id uuid references monitoring_runs(id) on delete set null,
  rule text not null,
  fingerprint text not null,
  severity text not null check (severity in ('info','attention','critical')),
  title text not null,
  what_changed text not null,
  why_matters text not null,
  affected jsonb not null,
  impact jsonb not null,
  suggested_action text not null,
  evidence jsonb not null,
  uses_demo_data boolean not null,
  analyzed_at timestamptz not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  occurrences int not null default 1,
  last_seen_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_user_idx on alerts(user_id, created_at desc);
create index alerts_fingerprint_idx on alerts(user_id, fingerprint, last_seen_at desc);

create table notifications (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  alert_id uuid references alerts(id) on delete cascade,
  channel text not null,       -- in_app | email | webhook
  status text not null,        -- delivered | queued | not_configured | failed | skipped
  title text not null,
  body text not null,
  detail text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);
create index notifications_user_idx on notifications(user_id, created_at desc);

-- ───────────────────────── Audit ─────────────────────────
create table audit_log (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  actor text not null,         -- user | system | agent
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on audit_log(user_id, created_at desc);

create table scheduler_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Grants & row-level security ─────────────────────────
grant usage on schema public to atlas_app;
grant select on data_sources, assets, asset_prices, macro_indicators, market_events, risk_metrics to atlas_app;
grant select on users to atlas_app;
grant select, insert, update, delete on investment_profiles, user_preferences, portfolios, positions, target_allocations to atlas_app;
grant select, insert, delete on recommendations, recommendation_evidence to atlas_app;
grant select, insert, update on monitoring_runs, alerts, notifications to atlas_app;
grant select, insert on monitoring_snapshots, portfolio_snapshots to atlas_app;
-- Audit log is append-only for the application role.
grant select, insert on audit_log to atlas_app;
grant usage on sequence audit_log_id_seq to atlas_app;

alter table users enable row level security;
create policy users_self on users for select to atlas_app using (id = app_current_user());

do $$
declare t text;
begin
  foreach t in array array[
    'investment_profiles','user_preferences','portfolios','positions','target_allocations',
    'recommendations','recommendation_evidence','monitoring_runs','monitoring_snapshots',
    'portfolio_snapshots','alerts','notifications','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to atlas_app using (user_id = app_current_user()) with check (user_id = app_current_user())',
      t || '_owner', t);
  end loop;
end $$;

-- Positions/targets must reference a portfolio owned by the same user.
create or replace function check_portfolio_owner() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from portfolios p where p.id = new.portfolio_id and p.user_id = new.user_id) then
    raise exception 'portfolio % does not belong to user', new.portfolio_id using errcode = '42501';
  end if;
  return new;
end $$;
create trigger positions_owner before insert or update on positions for each row execute function check_portfolio_owner();
create trigger targets_owner before insert or update on target_allocations for each row execute function check_portfolio_owner();
