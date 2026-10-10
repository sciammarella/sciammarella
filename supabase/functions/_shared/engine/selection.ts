// Offer normalization, eligibility filtering and ranking.
// Mandatory user constraints are hard filters — ranking never overrides them.

import { airlineName } from "./airlines.ts";
import type { FlightSearchRequest } from "./providers.ts";
import type { EvaluatedOffer, FlightMission, FlightOffer, TimeWindow } from "./types.ts";
import { addDays, roundMoney } from "./util.ts";

export const TIME_WINDOWS: Record<Exclude<TimeWindow, "any">, [number, number]> = {
  morning: [5, 12],
  afternoon: [12, 18],
  evening: [18, 24],
};

export function candidateDates(date: string, flexibleDays: number): string[] {
  const dates: string[] = [date];
  for (let i = 1; i <= flexibleDays; i++) dates.push(addDays(date, -i), addDays(date, i));
  return dates;
}

export function payingPassengers(mission: FlightMission): number {
  const p = mission.preferences.passengers;
  return p.adults + p.children + p.infants;
}

export function buildSearchRequest(mission: FlightMission): FlightSearchRequest {
  const p = mission.preferences;
  const slices = [
    {
      originAirports: p.originAirports,
      destinationAirports: p.destinationAirports,
      departureDates: candidateDates(mission.departureDate, p.flexibleDays),
    },
  ];
  if (p.tripType === "round_trip" && mission.returnDate) {
    slices.push({
      originAirports: p.destinationAirports,
      destinationAirports: p.originAirports,
      departureDates: candidateDates(mission.returnDate, p.flexibleDays),
    });
  }
  return {
    missionId: mission.id,
    slices,
    passengers: p.passengers,
    cabin: p.cabin,
    maxConnections: p.maxStops,
    currency: mission.currency,
  };
}

function hourOf(localIso: string): number {
  return parseInt(localIso.slice(11, 13), 10) + parseInt(localIso.slice(14, 16), 10) / 60;
}

function inWindow(localIso: string, window: TimeWindow): boolean {
  if (window === "any") return true;
  const [from, to] = TIME_WINDOWS[window];
  const h = hourOf(localIso);
  return h >= from && h < to;
}

/** Hard spending ceiling: authorized maximum + configured tolerance (never negative). */
export function spendingCeiling(mission: FlightMission): number {
  const cap = Math.min(mission.maximumAuthorizedAmount, mission.purchaseAuthorization?.maxAmount ?? mission.maximumAuthorizedAmount);
  return roundMoney(cap + Math.max(0, mission.priceTolerance || 0), mission.currency);
}

export function evaluateOffer(offer: FlightOffer, mission: FlightMission): EvaluatedOffer {
  const p = mission.preferences;
  const v: string[] = [];
  const pax = p.passengers;
  const bagPax = pax.adults + pax.children;

  if (offer.currency !== mission.currency) v.push(`Priced in ${offer.currency}, authorization is in ${mission.currency}`);
  if (offer.passengers.adults !== pax.adults || offer.passengers.children !== pax.children || offer.passengers.infants !== pax.infants)
    v.push("Passenger configuration differs from the mission");

  const expectedSlices = p.tripType === "round_trip" ? 2 : 1;
  if (offer.slices.length !== expectedSlices) v.push(`Expected ${expectedSlices} slice(s), got ${offer.slices.length}`);

  const [out, ret] = offer.slices;
  const dates = [mission.departureDate, mission.returnDate];
  offer.slices.forEach((slice, i) => {
    const label = i === 0 ? "Outbound" : "Return";
    const allowedFrom = i === 0 ? p.originAirports : p.destinationAirports;
    const allowedTo = i === 0 ? p.destinationAirports : p.originAirports;
    if (!allowedFrom.includes(slice.origin)) v.push(`${label} departs from ${slice.origin}, not an authorized airport`);
    if (!allowedTo.includes(slice.destination)) v.push(`${label} arrives at ${slice.destination}, not an authorized airport`);

    const date = dates[i];
    if (date) {
      const allowed = candidateDates(date, p.flexibleDays);
      if (!allowed.includes(slice.departureAt.slice(0, 10))) v.push(`${label} date ${slice.departureAt.slice(0, 10)} is outside the authorized dates`);
    }

    const stops = slice.segments.length - 1;
    if (stops > p.maxStops) v.push(`${label} has ${stops} stops (max ${p.maxStops})`);
    if (p.maxDurationHours && slice.durationMinutes > p.maxDurationHours * 60)
      v.push(`${label} takes ${Math.round(slice.durationMinutes / 60)}h (max ${p.maxDurationHours}h)`);

    for (let s = 1; s < slice.segments.length; s++) {
      const conn = (Date.parse(`${slice.segments[s].departureAt}Z`) - Date.parse(`${slice.segments[s - 1].arrivalAt}Z`)) / 60000;
      // Connection is measured at the same airport, so local times are comparable.
      if (conn < p.minConnectionMinutes) v.push(`${label} connection at ${slice.segments[s].origin} is ${Math.round(conn)} min (min ${p.minConnectionMinutes})`);
    }

    if (slice.segments.some((seg) => seg.cabin !== p.cabin)) v.push(`${label} includes a cabin other than ${p.cabin.replace("_", " ")}`);

    const window = i === 0 ? p.outboundTimeWindow : p.returnTimeWindow;
    if (!inWindow(slice.departureAt, window)) v.push(`${label} departs at ${slice.departureAt.slice(11, 16)}, outside ${window}`);

    const carriers = slice.segments.map((s) => s.marketingCarrier);
    if (p.airlineMode === "only" && p.preferredAirlines.length > 0) {
      const bad = carriers.filter((c) => !p.preferredAirlines.includes(c));
      if (bad.length) v.push(`${label} uses ${[...new Set(bad)].map(airlineName).join(", ")} (not in your required airlines)`);
    }
    if (!p.allowMixedCarriers && new Set(carriers).size > 1) v.push(`${label} combines several airlines`);
  });

  if (out && ret && !p.allowMixedAirports) {
    if (ret.origin !== out.destination) v.push(`Return departs from ${ret.origin} but outbound arrives at ${out.destination}`);
    if (ret.destination !== out.origin) v.push(`Return arrives at ${ret.destination} but outbound departs from ${out.origin}`);
  }

  // Mandatory baggage: add the cost of missing bags, or reject if they cannot be bought.
  let requiredBagCost = 0;
  const missingBags = Math.max(0, p.checkedBagsPerPassenger - offer.includedCheckedBagsPerPassenger);
  if (missingBags > 0) {
    if (offer.extraBagPrice === null) v.push(`Fare does not allow adding ${missingBags} required checked bag(s)`);
    else requiredBagCost = roundMoney(missingBags * bagPax * offer.slices.length * offer.extraBagPrice, mission.currency);
  }

  const payableTotal = roundMoney(offer.totalAmount + requiredBagCost, mission.currency);
  const paying = pax.adults + pax.children + pax.infants;
  if (p.maxPricePerPassenger && payableTotal / Math.max(1, paying) > p.maxPricePerPassenger)
    v.push(`Price per passenger exceeds ${p.maxPricePerPassenger} ${mission.currency}`);

  const withinAuthorization = payableTotal <= spendingCeiling(mission);
  return {
    offer,
    payableTotal,
    requiredBagCost,
    eligible: v.length === 0,
    violations: v,
    withinTarget: payableTotal <= mission.targetPrice,
    withinAuthorization,
    totalDurationMinutes: offer.slices.reduce((s, x) => s + x.durationMinutes, 0),
    totalStops: offer.slices.reduce((s, x) => s + x.segments.length - 1, 0),
  };
}

export function rankOffers(evaluated: EvaluatedOffer[], mission: FlightMission): EvaluatedOffer[] {
  const p = mission.preferences;
  const preferred = new Set(p.preferredAirlines);
  const prefScore = (e: EvaluatedOffer) =>
    preferred.size === 0 ? 0 : e.offer.slices.flatMap((s) => s.segments).every((s) => preferred.has(s.marketingCarrier)) ? 0 : 1;
  const byPrice = (a: EvaluatedOffer, b: EvaluatedOffer) => a.payableTotal - b.payableTotal;
  const byDuration = (a: EvaluatedOffer, b: EvaluatedOffer) => a.totalDurationMinutes - b.totalDurationMinutes;
  const byStops = (a: EvaluatedOffer, b: EvaluatedOffer) => a.totalStops - b.totalStops;
  const byPref = (a: EvaluatedOffer, b: EvaluatedOffer) => prefScore(a) - prefScore(b);
  const byBudget = (a: EvaluatedOffer, b: EvaluatedOffer) => Number(b.withinAuthorization) - Number(a.withinAuthorization);

  const chains = {
    lowest_price: [byBudget, byPrice, byDuration, byStops, byPref],
    shortest_duration: [byBudget, byDuration, byPrice, byStops],
    fewest_stops: [byBudget, byStops, byPrice, byDuration],
    preferred_airline: [byBudget, byPref, byPrice, byDuration, byStops],
  } as const;
  const chain = chains[p.ranking] ?? chains.lowest_price;
  return [...evaluated]
    .filter((e) => e.eligible)
    .sort((a, b) => {
      for (const cmp of chain) {
        const r = cmp(a, b);
        if (r !== 0) return r;
      }
      return a.offer.id.localeCompare(b.offer.id);
    });
}

export function describeOffer(offer: FlightOffer): string {
  return offer.slices
    .map((s) => `${s.origin}→${s.destination} ${s.departureAt.slice(0, 10)} ${s.segments.map((x) => x.flightNumber).join("/")}`)
    .join(" · ");
}
