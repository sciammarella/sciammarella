# FareBuddy — autonomous flight booking agent

Tell FareBuddy where you want to go, when, and the most you'll pay. It monitors
fares and books an eligible itinerary when the **full payable total** (all
passengers, taxes, mandatory fees, required bags) reaches your target, using a
payment method you authorized in advance.

> **Status: MVP.** The demo workflow runs end to end. Live booking is wired
> through provider adapters but **has not been run against live credentials**.
> See [What is real vs. simulated](#what-is-real-vs-simulated).

## Quick start (browser-only demo, no setup)

```bash
npm install
npm run dev        # http://localhost:5173
```

If `VITE_SUPABASE_URL` is not set, the app uses a **browser demo runtime**: the
real booking engine runs in your tab against the simulated flight provider and
data lives in `localStorage`. Monitoring runs only while a FareBuddy tab is open
(the Supabase deployment uses a server-side scheduler instead).

Demo walkthrough:

1. Sign up, then add a traveler under **Passengers**.
2. Under **Payments**, add a demo card or create a demo USDC wallet and simulate a deposit.
3. **Create a Flight Mission** → "Use example: Vitória → Tokyo" → finish the steps.
4. On the review step, read the authorization summary, optionally turn on
   automatic purchase, tick the consent box, then **Authorize & activate**.
5. On the mission page, **Demo simulation controls** let you force a fare drop
   and choose the booking outcome (success, ticketing pending, timeout then
   reconciled, offer gone, price jump, payment declined).

## Architecture

```
src/                      React + TypeScript + Tailwind + shadcn/ui
  backend/local.ts        Browser demo runtime (engine + localStorage)
  backend/supabase.ts     Reads via RLS, writes via the `api` Edge Function
  pages/                  Landing, auth, dashboard, mission wizard/detail,
                          passengers, payments, bookings, notifications, settings
supabase/
  migrations/             Schema, RLS, locking & wallet functions, pg_cron job
  functions/
    _shared/engine/       Runtime-agnostic core, shared by browser and Deno:
      engine.ts           Monitoring + booking workflow
      selection.ts        Normalization, hard-constraint filtering, ranking
      authorization.ts    Consent summary, constraint hash, material-change detection
      service.ts          Save/activate/pause/cancel, passengers, wallets
      providers.ts        FlightProvider / PaymentGateway interfaces
      demoFlightProvider.ts  Simulated offers, price movement, orders
      duffelFlightProvider.ts  Live adapter (unverified)
      payments.ts         Demo card, wallet reservations, Stripe gateway (unverified)
    api/                  Authenticated RPC for every browser write
    monitor-missions/     Scheduled worker, invoked every minute by pg_cron
tests/                    Vitest: engine workflow + service rules
```

The frontend doesn't change between demo and live. Only the provider objects do
(`supabase/functions/_shared/runtime.ts`).

### Booking workflow (`engine.ts`)

1. Load the mission. Expire it if the departure date has arrived.
2. **Reconcile** any attempt whose outcome is unknown. Never search or buy on top of one.
3. Search, then normalize offers (required-bag cost is added to the total).
4. Filter by every mandatory constraint: airports, dates (± authorized flex),
   cabin, stops, connection time, duration, time windows, airlines, passenger
   mix, currency and per-passenger cap.
5. Rank: within budget first, then lowest total, then duration and stops (configurable).
6. Record the observation, and send *approaching* / *reached* notifications when the price crosses a threshold.
7. Check the authorization: not revoked, constraint hash unchanged, ceiling not raised, payment method unchanged.
8. Take the per-mission lock (atomic compare-and-set) and re-read the mission.
9. Create the attempt with a deterministic idempotency key (unique in the DB).
10. **Revalidate** price and availability. Abort if the offer is gone, no longer
    eligible, or above `maximum + tolerance` (tolerance defaults to 0).
11. Hold payment: a card authorization, or the mission's wallet reservation.
12. Submit the order. Any timeout or error marks the attempt `unknown`, and the
    next cycle reconciles it with the provider before anything else happens.
13. On confirmation: capture payment, save the booking, notify. On failure:
    release the hold and resume monitoring if the failure can be retried.

Database guarantees back up the engine: a unique idempotency key, at most one
confirmed booking per mission (partial unique index), and wallet reservations
that lock the wallet row (`reserve_wallet_funds`).

## Supabase deployment

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set PASSENGER_DATA_KEY=$(openssl rand -base64 32) CRON_SECRET=<random> APP_URL=https://...
supabase functions deploy api
supabase functions deploy monitor-missions --no-verify-jwt
```

Then store the project URL and cron secret in Vault (see
`supabase/migrations/20261010000100_schedule.sql`) so pg_cron can call the
worker every minute. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the frontend.

Security model:
- RLS on every table. Browsers can only **read** their own rows. Writes that
  touch money, authorization, passengers or bookings go through Edge Functions,
  which check ownership.
- Passenger records are encrypted with AES-256-GCM in the Edge Function, with
  the owner bound as associated data. The ciphertext column is never granted to
  browsers, and passport data is kept out of audit logs.
- No raw card numbers, CVVs or private keys are stored anywhere.
- `audit_events` is append-only.

## What is real vs. simulated

| Area | Status |
|---|---|
| Auth, missions, RLS, audit log, notifications | Implemented (Supabase), or local in browser demo |
| Booking engine: locking, idempotency, reconciliation, tolerance | Implemented and covered by tests |
| Flight offers & bookings in demo | **Simulated** (`DemoFlightProvider`) and labeled DEMO everywhere |
| Duffel live adapter | Written against Duffel's v2 API, **not verified**. Needs a live token, go-live approval and a funded balance. Paid extra bags aren't supported yet. Unknown outcomes go to manual review. |
| Stripe card holds (live) | SetupIntent + Elements capture, manual-capture PaymentIntents. **Not verified.** Needs a commercial model that lets FareBuddy charge travellers (e.g. merchant of record) and settle with the booking provider. |
| Stablecoin wallets | **Simulated** deposits and confirmations. Deposit addresses are deliberately invalid. Live custody needs a provider adapter (`WALLET_PROVIDER_API_KEY`). |
| Email | Resend, once `RESEND_API_KEY` is set. Otherwise in-app only. |
| Visa / entry requirements | **Not verified.** Shown as "Not verified". Passports must be valid through the end of the trip, and expiry within 6 months gets a warning. |

Live mode turns on only when `evaluateLiveReadiness` passes: an explicit
`LIVE_BOOKING_ENABLED=true`, a non-test Duffel token, a live Stripe key and the
passenger encryption key. A mission keeps its creation mode for its whole life,
so a demo mission can never spend real money.

## Scripts

```bash
npm run dev         # Vite dev server
npm run build       # typecheck + production build
npm test            # Vitest (engine + service)
```
