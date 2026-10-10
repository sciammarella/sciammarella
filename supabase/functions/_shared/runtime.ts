// Builds engine dependencies for the requested mode. Live mode is refused
// unless every required integration is configured (see liveReadiness.ts).

import { createClient } from "npm:@supabase/supabase-js@2";
import { DemoFlightProvider } from "./engine/demoFlightProvider.ts";
import { DuffelFlightProvider } from "./engine/duffelFlightProvider.ts";
import type { EngineDeps } from "./engine/engine.ts";
import { evaluateLiveReadiness } from "./engine/liveReadiness.ts";
import { importPassengerKey } from "./engine/passengerCrypto.ts";
import { DemoCardGateway, StripeCardGateway, WalletGateway } from "./engine/payments.ts";
import { ProviderUnavailableError } from "./engine/providers.ts";
import type { RuntimeMode } from "./engine/types.ts";
import { SupabaseServiceStore } from "./supabaseStore.ts";

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service credentials are not available");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function buildRuntime() {
  const env = Deno.env.toObject();
  const readiness = evaluateLiveReadiness(env);
  const db = serviceClient();
  const passengerKey = env.PASSENGER_DATA_KEY ? await importPassengerKey(env.PASSENGER_DATA_KEY) : null;
  const store = new SupabaseServiceStore(db, passengerKey);
  const systemMode: RuntimeMode = readiness.liveAvailable && env.APP_MODE === "live" ? "live" : "demo";
  const demoSpeed = Math.max(1, Number(env.DEMO_SPEED ?? "60"));

  const depsFor = (mode: RuntimeMode): EngineDeps => {
    if (mode === "live") {
      if (!readiness.liveAvailable) {
        const missing = readiness.checks.filter((c) => c.required && !c.ok).map((c) => c.label);
        throw new ProviderUnavailableError(`Live mode is unavailable. Missing: ${missing.join(", ")}`);
      }
      return {
        store,
        flights: new DuffelFlightProvider(env.DUFFEL_ACCESS_TOKEN!),
        cardGateway: new StripeCardGateway(env.STRIPE_SECRET_KEY!),
        walletGateway: new WalletGateway(store, "live"),
        workerId: "edge",
      };
    }
    return {
      store,
      flights: new DemoFlightProvider(store.providerState()),
      cardGateway: new DemoCardGateway(),
      walletGateway: new WalletGateway(store, "demo"),
      workerId: "edge",
      demoSpeed,
    };
  };

  return { db, store, readiness, systemMode, demoSpeed, depsFor, env };
}
