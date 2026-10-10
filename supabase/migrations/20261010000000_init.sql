-- FareBuddy core schema
-- Security model:
--   * Every table has RLS enabled. Users can only SELECT their own rows.
--   * All writes that affect money, authorization, passengers or bookings go
--     through Edge Functions using the service role (server-side validation).
--   * Users may only mark their own notifications as read and edit their profile name.
--   * Raw card numbers, CVVs and private keys are never stored. Passenger
--     documents are stored AES-256-GCM encrypted by the Edge Function.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types

create type public.runtime_mode as enum ('demo', 'live');
create type public.mission_status as enum (
  'draft', 'monitoring', 'target_reached', 'booking_in_progress', 'booked',
  'action_required', 'paused', 'expired', 'booking_failed', 'cancelled'
);
create type public.payment_type as enum ('card', 'stablecoin_wallet');
create type public.authorization_status as enum ('active', 'pending', 'revoked', 'requires_action');
create type public.attempt_status as enum (
  'created', 'revalidating', 'payment_authorized', 'submitted', 'unknown', 'confirmed', 'failed', 'aborted'
);

-- ---------------------------------------------------------------------------
-- Profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Passengers (sensitive fields encrypted server-side)

create table public.passenger_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  passenger_type text not null default 'adult' check (passenger_type in ('adult', 'child', 'infant')),
  nationality text,
  passport_last4 text check (passport_last4 is null or length(passport_last4) <= 4),
  passport_expiry date,
  -- base64(iv || AES-256-GCM ciphertext) of the full passenger record.
  encrypted_sensitive_data text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.passenger_profiles (user_id);

-- ---------------------------------------------------------------------------
-- Payment methods (tokens / wallet references only)

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode public.runtime_mode not null,
  payment_type public.payment_type not null,
  label text not null,
  provider text not null,
  provider_reference text,
  token_or_wallet_reference text,
  currency text not null default 'USD',
  -- Wallets: CONFIRMED on-chain balance only. Pending deposits never count.
  available_balance numeric(14, 2),
  authorization_status public.authorization_status not null default 'pending',
  card jsonb,
  wallet jsonb,
  created_at timestamptz not null default now()
);
create index on public.payment_methods (user_id);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.payment_methods (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  direction text not null check (direction in ('deposit', 'spend', 'refund')),
  amount numeric(14, 2) not null check (amount > 0),
  token text not null,
  network text not null,
  tx_hash text not null,
  confirmations int not null default 0,
  required_confirmations int not null,
  status text not null check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  unique (payment_method_id, tx_hash, direction)
);
create index on public.wallet_transactions (user_id);

-- ---------------------------------------------------------------------------
-- Missions

create table public.flight_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode public.runtime_mode not null,
  title text not null,
  origin jsonb not null,
  destination jsonb not null,
  departure_date date not null,
  return_date date,
  passenger_profile_ids uuid[] not null default '{}',
  flight_preferences jsonb not null,
  target_price numeric(12, 2) not null check (target_price > 0),
  maximum_authorized_amount numeric(12, 2) not null check (maximum_authorized_amount > 0),
  price_tolerance numeric(12, 2) not null default 0 check (price_tolerance >= 0),
  currency text not null,
  payment_method_id uuid references public.payment_methods (id),
  monitoring_status public.mission_status not null default 'draft',
  monitoring_interval_minutes int not null default 60 check (monitoring_interval_minutes >= 15),
  purchase_authorization jsonb,
  best_offer jsonb,
  lowest_observed numeric(12, 2),
  last_checked_at timestamptz,
  next_check_at timestamptz,
  check_count int not null default 0,
  last_error text,
  status_reason text,
  notification_state jsonb not null default '{}',
  demo_controls jsonb,
  booking_lock_owner text,
  booking_lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_authorized_amount >= target_price),
  check (return_date is null or return_date >= departure_date),
  -- Demo controls can never exist on live missions.
  check (mode = 'demo' or demo_controls is null)
);
create index on public.flight_missions (user_id);
create index flight_missions_due_idx on public.flight_missions (next_check_at)
  where monitoring_status in ('monitoring', 'target_reached', 'booking_in_progress', 'booking_failed', 'booked');

create table public.wallet_reservations (
  id uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.payment_methods (id) on delete cascade,
  mission_id uuid not null references public.flight_missions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null check (status in ('held', 'captured', 'released')),
  captured_amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live reservation per mission.
create unique index wallet_reservations_one_held on public.wallet_reservations (mission_id) where status = 'held';

create table public.flight_price_observations (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.flight_missions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  itinerary_reference text not null,
  total_price numeric(12, 2) not null,
  currency text not null,
  eligible boolean not null default true,
  observed_at timestamptz not null default now(),
  offer_metadata jsonb not null default '{}'
);
create index on public.flight_price_observations (mission_id, observed_at desc);

create table public.booking_attempts (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.flight_missions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode public.runtime_mode not null,
  offer_id text not null,
  provider_reference text,
  payment_reference text,
  idempotency_key text not null unique,
  status public.attempt_status not null,
  amount numeric(12, 2) not null,
  currency text not null,
  failure_reason text,
  reconcile_attempts int not null default 0,
  offer_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.booking_attempts (mission_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.flight_missions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode public.runtime_mode not null,
  provider text not null,
  provider_booking_reference text not null,
  airline_booking_reference text not null,
  total_paid numeric(12, 2) not null,
  currency text not null,
  booking_status text not null check (booking_status in ('confirmed', 'cancelled')),
  ticketing_status text not null check (ticketing_status in ('issued', 'pending', 'not_issued')),
  ticket_numbers text[] not null default '{}',
  itinerary_details jsonb not null,
  passenger_names text[] not null default '{}',
  payment_summary jsonb not null,
  provider_confirmation jsonb not null,
  documents jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Database-level guarantee: at most one confirmed booking per mission.
create unique index bookings_one_confirmed_per_mission on public.bookings (mission_id) where booking_status = 'confirmed';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid references public.flight_missions (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  severity text not null check (severity in ('info', 'success', 'warning', 'critical')),
  requires_action boolean not null default false,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid references public.flight_missions (id) on delete cascade,
  kind text not null,
  message text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_events (mission_id, created_at desc);

-- Demo provider persistence (simulated orders). Service role only.
create table public.demo_provider_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_missions before update on public.flight_missions for each row execute function public.touch_updated_at();
create trigger touch_passengers before update on public.passenger_profiles for each row execute function public.touch_updated_at();
create trigger touch_attempts before update on public.booking_attempts for each row execute function public.touch_updated_at();
create trigger touch_bookings before update on public.bookings for each row execute function public.touch_updated_at();

-- Audit log is append-only.
create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;
create trigger audit_append_only before update or delete on public.audit_events
  for each row when (pg_trigger_depth() = 0 and current_setting('farebuddy.allow_audit_delete', true) is distinct from 'on')
  execute function public.prevent_audit_mutation();

-- Users may only flip read_at on their notifications.
create or replace function public.guard_notification_update()
returns trigger language plpgsql as $$
begin
  if auth.role() <> 'service_role' then
    if (new.user_id, new.kind, new.title, new.body, new.severity, new.mission_id, new.requires_action, new.created_at)
       is distinct from (old.user_id, old.kind, old.title, old.body, old.severity, old.mission_id, old.requires_action, old.created_at) then
      raise exception 'Only read_at can be changed';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_notifications before update on public.notifications for each row execute function public.guard_notification_update();

-- ---------------------------------------------------------------------------
-- Engine functions (service role only)

-- Atomic compare-and-set booking lock.
create or replace function public.acquire_booking_lock(p_mission_id uuid, p_owner text, p_ttl_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  locked boolean;
begin
  update public.flight_missions
     set booking_lock_owner = p_owner,
         booking_lock_expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = p_mission_id
     and (booking_lock_owner is null or booking_lock_expires_at < now() or booking_lock_owner = p_owner)
  returning true into locked;
  return coalesce(locked, false);
end;
$$;

create or replace function public.release_booking_lock(p_mission_id uuid, p_owner text)
returns void language sql security definer set search_path = public as $$
  update public.flight_missions
     set booking_lock_owner = null, booking_lock_expires_at = null
   where id = p_mission_id and booking_lock_owner = p_owner;
$$;

-- Earmark wallet funds for a mission. Locks the wallet row so concurrent
-- activations cannot double-spend the same balance.
create or replace function public.reserve_wallet_funds(p_payment_method_id uuid, p_mission_id uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_balance numeric;
  v_held numeric;
  v_user uuid;
  v_id uuid;
begin
  select available_balance, user_id into v_balance, v_user
    from public.payment_methods
   where id = p_payment_method_id and payment_type = 'stablecoin_wallet'
   for update;
  if v_user is null then
    raise exception 'Wallet not found';
  end if;
  select id into v_id from public.wallet_reservations where mission_id = p_mission_id and status = 'held';
  if v_id is not null then
    update public.wallet_reservations set status = 'released', updated_at = now() where id = v_id;
  end if;
  select coalesce(sum(amount), 0) into v_held
    from public.wallet_reservations
   where payment_method_id = p_payment_method_id and status = 'held';
  if coalesce(v_balance, 0) - v_held < p_amount then
    raise exception 'Insufficient available balance: % available, % required', coalesce(v_balance, 0) - v_held, p_amount;
  end if;
  insert into public.wallet_reservations (payment_method_id, mission_id, user_id, amount, status)
  values (p_payment_method_id, p_mission_id, v_user, p_amount, 'held')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.capture_wallet_reservation(p_reservation_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.wallet_reservations%rowtype;
  w public.payment_methods%rowtype;
begin
  select * into r from public.wallet_reservations where id = p_reservation_id for update;
  if r.id is null or r.status <> 'held' then
    raise exception 'Reservation is not held';
  end if;
  if p_amount > r.amount then
    raise exception 'Capture exceeds reserved amount';
  end if;
  select * into w from public.payment_methods where id = r.payment_method_id for update;
  update public.wallet_reservations set status = 'captured', captured_amount = p_amount, updated_at = now() where id = r.id;
  update public.payment_methods set available_balance = available_balance - p_amount where id = w.id;
  insert into public.wallet_transactions (payment_method_id, user_id, direction, amount, token, network, tx_hash, confirmations, required_confirmations, status)
  values (w.id, w.user_id, 'spend', p_amount, w.wallet ->> 'token', w.wallet ->> 'network', 'ledger:' || r.id::text,
          coalesce((w.wallet ->> 'requiredConfirmations')::int, 0), coalesce((w.wallet ->> 'requiredConfirmations')::int, 0), 'confirmed');
end;
$$;

-- Credit a deposit only once it has the required confirmations.
create or replace function public.confirm_wallet_deposit(p_transaction_id uuid, p_confirmations int)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.wallet_transactions%rowtype;
begin
  select * into t from public.wallet_transactions where id = p_transaction_id for update;
  if t.id is null or t.direction <> 'deposit' or t.status <> 'pending' then
    return;
  end if;
  if p_confirmations >= t.required_confirmations then
    update public.wallet_transactions set confirmations = p_confirmations, status = 'confirmed' where id = t.id;
    update public.payment_methods set available_balance = coalesce(available_balance, 0) + t.amount where id = t.payment_method_id;
  else
    update public.wallet_transactions set confirmations = p_confirmations where id = t.id;
  end if;
end;
$$;

revoke all on function public.acquire_booking_lock(uuid, text, int) from public, anon, authenticated;
revoke all on function public.release_booking_lock(uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_wallet_funds(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.capture_wallet_reservation(uuid, numeric) from public, anon, authenticated;
revoke all on function public.confirm_wallet_deposit(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security

alter table public.profiles enable row level security;
alter table public.passenger_profiles enable row level security;
alter table public.payment_methods enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wallet_reservations enable row level security;
alter table public.flight_missions enable row level security;
alter table public.flight_price_observations enable row level security;
alter table public.booking_attempts enable row level security;
alter table public.bookings enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
alter table public.demo_provider_state enable row level security;

create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "own passengers read" on public.passenger_profiles for select using (auth.uid() = user_id);
create policy "own payment methods read" on public.payment_methods for select using (auth.uid() = user_id);
create policy "own wallet tx read" on public.wallet_transactions for select using (auth.uid() = user_id);
create policy "own reservations read" on public.wallet_reservations for select using (auth.uid() = user_id);
create policy "own missions read" on public.flight_missions for select using (auth.uid() = user_id);
create policy "own observations read" on public.flight_price_observations for select using (auth.uid() = user_id);
create policy "own attempts read" on public.booking_attempts for select using (auth.uid() = user_id);
create policy "own bookings read" on public.bookings for select using (auth.uid() = user_id);
create policy "own notifications read" on public.notifications for select using (auth.uid() = user_id);
create policy "own notifications mark read" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own audit read" on public.audit_events for select using (auth.uid() = user_id);
-- demo_provider_state: no policies → service role only.

-- Defense in depth: browsers may read, never write (except the two cases below).
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke all on public.demo_provider_state from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Column-level privileges: the encrypted passenger blob and the internal lock
-- columns never reach the browser.
revoke select on public.passenger_profiles from anon, authenticated;
grant select (id, user_id, display_name, passenger_type, nationality, passport_last4, passport_expiry, created_at, updated_at)
  on public.passenger_profiles to authenticated;
revoke select on public.flight_missions from anon, authenticated;
grant select (
  id, user_id, mode, title, origin, destination, departure_date, return_date, passenger_profile_ids, flight_preferences,
  target_price, maximum_authorized_amount, price_tolerance, currency, payment_method_id, monitoring_status,
  monitoring_interval_minutes, purchase_authorization, best_offer, lowest_observed, last_checked_at, next_check_at,
  check_count, last_error, status_reason, notification_state, demo_controls, created_at, updated_at
) on public.flight_missions to authenticated;

-- Realtime for live dashboard updates.
alter publication supabase_realtime add table public.flight_missions, public.notifications, public.bookings;
