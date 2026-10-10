// Purchase authorization: what exactly the agent may buy without asking again.

import { airlineName } from "./airlines.ts";
import { placeLabel } from "./airports.ts";
import type { FlightMission, PaymentMethod, PurchaseAuthorization } from "./types.ts";
import { hashString, stableStringify } from "./util.ts";

const CABIN_LABEL = { economy: "Economy", premium_economy: "Premium Economy", business: "Business", first: "First" } as const;
const WINDOW_LABEL = { morning: "morning (05:00–12:00)", afternoon: "afternoon (12:00–18:00)", evening: "evening (18:00–24:00)", any: "any time" } as const;

type MissionConstraints = Pick<
  FlightMission,
  "departureDate" | "returnDate" | "currency" | "paymentMethodId" | "passengerProfileIds" | "priceTolerance" | "mode"
> & { preferences: Omit<FlightMission["preferences"], "ranking" | "preferredAirlines" | "airlineMode"> & { requiredAirlines: string[] } };

/** Every field whose change requires renewed consent. */
export function materialConstraints(m: FlightMission): MissionConstraints {
  const { ranking: _r, preferredAirlines, airlineMode, ...prefs } = m.preferences;
  return {
    mode: m.mode,
    departureDate: m.departureDate,
    returnDate: m.preferences.tripType === "round_trip" ? m.returnDate : null,
    currency: m.currency,
    paymentMethodId: m.paymentMethodId,
    passengerProfileIds: [...m.passengerProfileIds].sort(),
    priceTolerance: m.priceTolerance,
    preferences: {
      ...prefs,
      originAirports: [...prefs.originAirports].sort(),
      destinationAirports: [...prefs.destinationAirports].sort(),
      requiredAirlines: airlineMode === "only" ? [...preferredAirlines].sort() : [],
    },
  };
}

export function constraintsHash(m: FlightMission): string {
  return hashString(stableStringify(materialConstraints(m)));
}

export function authorizationSummary(m: FlightMission, paymentMethod: PaymentMethod | null, passengerNames: string[]): string[] {
  const p = m.preferences;
  const lines: string[] = [];
  const route = `${p.originAirports.join("/")} → ${p.destinationAirports.join("/")}`;
  lines.push(
    p.tripType === "round_trip"
      ? `Round trip ${placeLabel(m.origin.code)} ⇄ ${placeLabel(m.destination.code)} (airports: ${route})`
      : `One way ${placeLabel(m.origin.code)} → ${placeLabel(m.destination.code)} (airports: ${route})`,
  );
  const flex = p.flexibleDays > 0 ? ` (±${p.flexibleDays} day${p.flexibleDays > 1 ? "s" : ""} authorized)` : " (exact date)";
  lines.push(`Depart ${m.departureDate}${flex}, ${WINDOW_LABEL[p.outboundTimeWindow]}`);
  if (p.tripType === "round_trip" && m.returnDate) lines.push(`Return ${m.returnDate}${flex}, ${WINDOW_LABEL[p.returnTimeWindow]}`);
  const pax = p.passengers;
  lines.push(
    `Passengers: ${pax.adults} adult${pax.adults !== 1 ? "s" : ""}${pax.children ? `, ${pax.children} child${pax.children > 1 ? "ren" : ""}` : ""}${pax.infants ? `, ${pax.infants} infant${pax.infants > 1 ? "s" : ""}` : ""}${passengerNames.length ? ` — ${passengerNames.join(", ")}` : ""}`,
  );
  lines.push(`${CABIN_LABEL[p.cabin]} cabin only, max ${p.maxStops} stop${p.maxStops !== 1 ? "s" : ""} per direction`);
  if (p.maxDurationHours) lines.push(`Max ${p.maxDurationHours}h travel time per direction, min ${p.minConnectionMinutes} min connections`);
  else lines.push(`Min ${p.minConnectionMinutes} min connections`);
  lines.push(`${p.checkedBagsPerPassenger} checked bag(s) per passenger must be included in the price`);
  if (p.airlineMode === "only" && p.preferredAirlines.length) lines.push(`Only these airlines: ${p.preferredAirlines.map(airlineName).join(", ")}`);
  if (p.allowNearbyAirports) lines.push("Nearby airports listed above are acceptable");
  if (p.allowMixedAirports) lines.push("Arriving and departing via different authorized airports is acceptable");
  lines.push(
    `Maximum total: ${m.maximumAuthorizedAmount.toLocaleString("en-US", { style: "currency", currency: m.currency })} including taxes, mandatory fees and required baggage${m.priceTolerance > 0 ? ` (+${m.priceTolerance} ${m.currency} tolerance)` : " (zero tolerance)"}`,
  );
  lines.push(`Currency: ${m.currency}. Offers priced in any other currency are ignored — no exchange-rate conversion is applied.`);
  if (paymentMethod) lines.push(`Payment method: ${paymentMethod.label}`);
  return lines;
}

export function consentText(m: FlightMission): string {
  const max = m.maximumAuthorizedAmount.toLocaleString("en-US", { style: "currency", currency: m.currency });
  return `I authorize FareBuddy to purchase one itinerary matching every condition above, for a total of no more than ${max}, using the selected payment method, without asking me again. FareBuddy may not change dates, airports, cabin, or passengers outside these conditions.`;
}

export function buildAuthorization(
  m: FlightMission,
  paymentMethod: PaymentMethod,
  passengerNames: string[],
  autoPurchase: boolean,
  now: string,
): PurchaseAuthorization {
  return {
    autoPurchase,
    maxAmount: m.maximumAuthorizedAmount,
    currency: m.currency,
    paymentMethodId: paymentMethod.id,
    passengerProfileIds: [...m.passengerProfileIds],
    constraintsHash: constraintsHash(m),
    summary: authorizationSummary(m, paymentMethod, passengerNames),
    consentText: consentText(m),
    authorizedAt: now,
    version: (m.purchaseAuthorization?.version ?? 0) + 1,
    revokedAt: null,
  };
}

export type AuthorizationCheck = { valid: true } | { valid: false; reason: string };

export function checkAuthorization(m: FlightMission): AuthorizationCheck {
  const a = m.purchaseAuthorization;
  if (!a) return { valid: false, reason: "No purchase authorization on file" };
  if (a.revokedAt) return { valid: false, reason: "Purchase authorization was revoked" };
  if (a.currency !== m.currency) return { valid: false, reason: "Authorization currency does not match the mission" };
  if (a.paymentMethodId !== m.paymentMethodId) return { valid: false, reason: "Payment method changed since authorization" };
  if (m.maximumAuthorizedAmount > a.maxAmount) return { valid: false, reason: "Maximum amount was raised above the authorized amount" };
  if (a.constraintsHash !== constraintsHash(m)) return { valid: false, reason: "Trip conditions changed since authorization" };
  return { valid: true };
}

/** Explain which material conditions differ between two versions of a mission. */
export function materialChanges(before: FlightMission, after: FlightMission): string[] {
  const a = materialConstraints(before);
  const b = materialConstraints(after);
  const changes: string[] = [];
  const cmp = (label: string, x: unknown, y: unknown) => {
    if (stableStringify(x) !== stableStringify(y)) changes.push(label);
  };
  cmp("Departure date", a.departureDate, b.departureDate);
  cmp("Return date", a.returnDate, b.returnDate);
  cmp("Currency", a.currency, b.currency);
  cmp("Payment method", a.paymentMethodId, b.paymentMethodId);
  cmp("Passengers", a.passengerProfileIds, b.passengerProfileIds);
  cmp("Price tolerance", a.priceTolerance, b.priceTolerance);
  const pa = a.preferences as unknown as Record<string, unknown>;
  const pb = b.preferences as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) cmp(`Preference: ${key}`, pa[key], pb[key]);
  if (after.maximumAuthorizedAmount > (before.purchaseAuthorization?.maxAmount ?? before.maximumAuthorizedAmount))
    changes.push("Maximum authorized amount increased");
  return changes;
}
