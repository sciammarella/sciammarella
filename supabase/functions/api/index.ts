// Authenticated RPC endpoint for every write the browser needs. The caller's
// identity comes from the Supabase JWT; data access uses the service role after
// explicit ownership checks in the shared service layer.

import { createClient } from "npm:@supabase/supabase-js@2";
import { runMissionCycle } from "../_shared/engine/engine.ts";
import { checkPassengerDocuments } from "../_shared/engine/mission.ts";
import {
  activateMission,
  activationCheck,
  addDemoCard,
  addDemoWallet,
  cancelMission,
  pauseMission,
  resumeMission,
  saveMission,
  savePassenger,
  ServiceError,
  simulateDeposit,
  walletAvailability,
} from "../_shared/engine/service.ts";
import type { DemoControls } from "../_shared/engine/types.ts";
import { errorMessage, uuid } from "../_shared/engine/util.ts";
import { buildRuntime } from "../_shared/runtime.ts";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await userClient.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: "Not authenticated" }, 401);

  let body: { action: string; [k: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const rt = await buildRuntime();
  const { store } = rt;
  const now = new Date().toISOString();
  const userId = user.id;

  const ownMission = async (id: unknown) => {
    const m = await store.getMission(String(id));
    if (!m || m.userId !== userId) throw new ServiceError("Mission not found");
    return m;
  };

  try {
    switch (body.action) {
      case "system.status":
        return json({
          mode: rt.systemMode,
          liveAvailable: rt.readiness.liveAvailable,
          checks: rt.readiness.checks,
          demoSpeed: rt.demoSpeed,
          stripePublishableKey: rt.systemMode === "live" ? (rt.env.STRIPE_PUBLISHABLE_KEY ?? null) : null,
          passengerEncryption: !!rt.env.PASSENGER_DATA_KEY,
        });

      case "mission.save":
        return json(await saveMission(store, userId, rt.systemMode, body.input as never, now));

      case "mission.activationCheck": {
        const m = await ownMission(body.missionId);
        return json({ issues: await activationCheck(store, userId, m, now) });
      }

      case "mission.activate":
        return json({ mission: await activateMission(store, userId, String(body.missionId), { autoPurchase: !!body.autoPurchase, consent: body.consent === true }, now) });

      case "mission.pause":
        return json({ mission: await pauseMission(store, userId, String(body.missionId)) });
      case "mission.resume":
        return json({ mission: await resumeMission(store, userId, String(body.missionId), now) });
      case "mission.cancel":
        return json({ mission: await cancelMission(store, userId, String(body.missionId), now) });

      case "mission.checkNow": {
        const m = await ownMission(body.missionId);
        return json({ result: await runMissionCycle(m.id, rt.depsFor(m.mode)) });
      }

      case "mission.approve": {
        const m = await ownMission(body.missionId);
        await store.audit({ userId, missionId: m.id, kind: "manual_approval", message: "User approved purchase of the current best eligible fare", data: {} });
        return json({ result: await runMissionCycle(m.id, rt.depsFor(m.mode), { manualApproval: true }) });
      }

      case "mission.demoControls": {
        const m = await ownMission(body.missionId);
        if (m.mode !== "demo") throw new ServiceError("Demo controls are not available for live missions");
        const controls = body.controls as DemoControls;
        const updated = await store.updateMission(m.id, { demoControls: { ...m.demoControls, ...controls } });
        await store.audit({ userId, missionId: m.id, kind: "demo_control", message: `DEMO control set: ${JSON.stringify(controls)}`, data: {} });
        return json({ mission: updated });
      }

      case "passenger.save":
        return json({ passenger: await savePassenger(store, userId, body.input as never, now) });

      case "passenger.get": {
        const [details] = await store.getPassengerDetails(userId, [String(body.id)]);
        if (!details) throw new ServiceError("Passenger not found");
        const summary = (await store.listPassengerSummaries(userId)).find((s) => s.id === details.id)!;
        return json({ details: { ...details, passengerType: summary.passengerType } });
      }

      case "passenger.documentChecks": {
        const m = await ownMission(body.missionId);
        const details = await store.getPassengerDetails(userId, m.passengerProfileIds);
        return json({ checks: details.map((d) => ({ passengerId: d.id, name: d.fullLegalName, checks: checkPassengerDocuments(d, m) })) });
      }

      case "passenger.delete": {
        const missions = await rt.db.from("flight_missions").select("id, monitoring_status, passenger_profile_ids").eq("user_id", userId);
        const inUse = (missions.data ?? []).some(
          (m: { monitoring_status: string; passenger_profile_ids: string[] }) =>
            m.passenger_profile_ids.includes(String(body.id)) && ["monitoring", "target_reached", "booking_in_progress"].includes(m.monitoring_status),
        );
        if (inUse) throw new ServiceError("This passenger is used by an active mission. Pause or cancel it first.");
        await store.deletePassenger(userId, String(body.id));
        return json({ ok: true });
      }

      case "payment.addDemoCard":
        if (rt.systemMode !== "demo") throw new ServiceError("Demo cards are disabled in live mode");
        return json({ paymentMethod: await addDemoCard(store, userId, String(body.brand ?? "visa"), now) });

      case "payment.addDemoWallet":
        if (rt.systemMode !== "demo") throw new ServiceError("No wallet custody provider is configured for live mode");
        return json({ paymentMethod: await addDemoWallet(store, userId, body.token as never, body.network as never, now) });

      case "payment.simulateDeposit":
        return json({ transaction: await simulateDeposit(store, userId, String(body.paymentMethodId), Number(body.amount), now) });

      case "payment.walletAvailability": {
        const pm = await store.getPaymentMethod(String(body.paymentMethodId));
        if (!pm || pm.userId !== userId) throw new ServiceError("Wallet not found");
        return json(await walletAvailability(store, pm));
      }

      case "payment.remove": {
        const pm = await store.getPaymentMethod(String(body.id));
        if (!pm || pm.userId !== userId) throw new ServiceError("Payment method not found");
        const missions = await store.missionsUsingPaymentMethod(pm.id);
        if (missions.some((m) => ["monitoring", "target_reached", "booking_in_progress"].includes(m.monitoringStatus)))
          throw new ServiceError("This payment method backs an active mission. Pause or cancel it first.");
        await store.updatePaymentMethod(pm.id, { authorizationStatus: "revoked" });
        await store.audit({ userId, missionId: null, kind: "payment_method_revoked", message: `${pm.label} revoked`, data: {} });
        return json({ ok: true });
      }

      case "payment.stripeSetupIntent": {
        // LIVE: create a SetupIntent so the card is tokenized by Stripe Elements.
        const sk = rt.env.STRIPE_SECRET_KEY;
        if (rt.systemMode !== "live" || !sk) throw new ServiceError("Card tokenization requires live Stripe configuration");
        const stripe = (path: string, params: Record<string, string>) =>
          fetch(`https://api.stripe.com/v1/${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": uuid() },
            body: new URLSearchParams(params),
          }).then((r) => r.json());
        const customer = await stripe("customers", { email: user.email ?? "", "metadata[user_id]": userId });
        const si = await stripe("setup_intents", { customer: customer.id, usage: "off_session", "payment_method_types[]": "card" });
        return json({ clientSecret: si.client_secret, setupIntentId: si.id });
      }

      case "payment.stripeFinalize": {
        const sk = rt.env.STRIPE_SECRET_KEY;
        if (rt.systemMode !== "live" || !sk) throw new ServiceError("Live Stripe is not configured");
        const si = await fetch(`https://api.stripe.com/v1/setup_intents/${String(body.setupIntentId)}?expand[]=payment_method`, {
          headers: { Authorization: `Bearer ${sk}` },
        }).then((r) => r.json());
        if (si.status !== "succeeded") throw new ServiceError("Card setup did not complete");
        const card = si.payment_method.card;
        const pm = await store.insertPaymentMethod({
          id: uuid(),
          userId,
          mode: "live",
          paymentType: "card",
          label: `${card.brand.toUpperCase()} •••• ${card.last4}`,
          provider: "stripe",
          providerReference: si.customer,
          tokenOrWalletReference: si.payment_method.id,
          currency: "USD",
          authorizationStatus: "active",
          card: { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year },
          wallet: null,
          confirmedBalance: null,
          createdAt: now,
        });
        return json({ paymentMethod: pm });
      }

      default:
        return json({ error: `Unknown action ${body.action}` }, 400);
    }
  } catch (err) {
    if (err instanceof ServiceError) return json({ error: err.message, details: err.details }, 422);
    console.error("api", body.action, errorMessage(err));
    return json({ error: errorMessage(err) }, 500);
  }
});
