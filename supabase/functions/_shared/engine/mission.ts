// Mission helpers shared by the UI and the server.

import { countryOf, placeLabel, resolvePlace } from "./airports.ts";
import type { FlightMission, FlightPreferences, PassengerDetails, PlaceRef } from "./types.ts";
import { addDays } from "./util.ts";

export const MONITORING_INTERVALS = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
  { minutes: 1440, label: "Daily" },
] as const;

export function defaultPreferences(): FlightPreferences {
  return {
    tripType: "round_trip",
    originAirports: [],
    destinationAirports: [],
    allowNearbyAirports: false,
    flexibleDays: 0,
    outboundTimeWindow: "any",
    returnTimeWindow: "any",
    maxStops: 2,
    preferredAirlines: [],
    airlineMode: "prefer",
    cabin: "economy",
    minConnectionMinutes: 60,
    maxDurationHours: null,
    checkedBagsPerPassenger: 1,
    passengers: { adults: 1, children: 0, infants: 0 },
    maxPricePerPassenger: null,
    allowMixedAirports: true,
    allowMixedCarriers: true,
    ranking: "lowest_price",
  };
}

export function placeRef(code: string): PlaceRef {
  return { code: code.toUpperCase(), label: placeLabel(code) };
}

/** Recompute concrete airports from the chosen places and the nearby toggle. */
export function withResolvedAirports(m: Pick<FlightMission, "origin" | "destination">, prefs: FlightPreferences): FlightPreferences {
  return {
    ...prefs,
    originAirports: resolvePlace(m.origin.code, prefs.allowNearbyAirports),
    destinationAirports: resolvePlace(m.destination.code, prefs.allowNearbyAirports),
  };
}

export function isInternational(m: Pick<FlightMission, "origin" | "destination">): boolean {
  return countryOf(m.origin.code) !== countryOf(m.destination.code);
}

export type MissionValidation = { field: string; message: string }[];

export function validateMissionDraft(m: FlightMission, today: string): MissionValidation {
  const errors: MissionValidation = [];
  const p = m.preferences;
  if (!m.origin.code) errors.push({ field: "origin", message: "Choose where you are flying from" });
  if (!m.destination.code) errors.push({ field: "destination", message: "Choose where you are flying to" });
  if (m.origin.code && m.origin.code === m.destination.code) errors.push({ field: "destination", message: "Destination must differ from origin" });
  if (p.originAirports.length === 0 && m.origin.code) errors.push({ field: "origin", message: "Origin is not a supported airport" });
  if (p.destinationAirports.length === 0 && m.destination.code) errors.push({ field: "destination", message: "Destination is not a supported airport" });
  if (!m.departureDate || m.departureDate <= today) errors.push({ field: "departureDate", message: "Departure must be after today" });
  if (p.tripType === "round_trip") {
    if (!m.returnDate) errors.push({ field: "returnDate", message: "Choose a return date" });
    else if (m.returnDate < m.departureDate) errors.push({ field: "returnDate", message: "Return must be on or after departure" });
  }
  if (p.passengers.adults < 1) errors.push({ field: "passengers", message: "At least one adult is required" });
  if (p.passengers.infants > p.passengers.adults) errors.push({ field: "passengers", message: "Each infant must travel with an adult" });
  if (p.passengers.adults + p.passengers.children + p.passengers.infants > 9) errors.push({ field: "passengers", message: "Maximum 9 passengers per mission" });
  if (!(m.targetPrice > 0)) errors.push({ field: "targetPrice", message: "Set a target price" });
  if (!(m.maximumAuthorizedAmount > 0)) errors.push({ field: "maximumAuthorizedAmount", message: "Set a maximum budget" });
  if (m.maximumAuthorizedAmount < m.targetPrice) errors.push({ field: "maximumAuthorizedAmount", message: "Maximum budget must be at least the target price" });
  if (m.priceTolerance < 0) errors.push({ field: "priceTolerance", message: "Tolerance cannot be negative" });
  return errors;
}

export type DocumentCheck = { level: "ok" | "error" | "unverified"; message: string };

/**
 * Travel document checks. Only checks that are universally reliable are
 * enforced; destination-specific entry rules are flagged as unverified.
 */
export function checkPassengerDocuments(p: PassengerDetails, m: Pick<FlightMission, "origin" | "destination" | "departureDate" | "returnDate">): DocumentCheck[] {
  const checks: DocumentCheck[] = [];
  const lastTravelDate = m.returnDate ?? m.departureDate;
  const international = isInternational(m);
  if (!p.fullLegalName || !p.dateOfBirth) checks.push({ level: "error", message: "Full legal name and date of birth are required" });
  if (international) {
    if (!p.passportNumber || !p.passportExpiry) checks.push({ level: "error", message: "Passport details are required for international travel" });
    else if (p.passportExpiry <= lastTravelDate) checks.push({ level: "error", message: `Passport expires ${p.passportExpiry}, before the trip ends (${lastTravelDate})` });
    else {
      checks.push({ level: "ok", message: `Passport valid through the end of the trip (${lastTravelDate})` });
      if (p.passportExpiry < addDays(lastTravelDate, 183))
        checks.push({ level: "unverified", message: "Passport expires within 6 months of travel. Many countries require 6 months' validity — confirm with the destination's official sources." });
    }
    checks.push({ level: "unverified", message: `Visa and entry requirements for ${placeLabel(m.destination.code)} have not been verified by FareBuddy. Check official government sources.` });
  }
  return checks;
}

export function missionTitle(m: Pick<FlightMission, "origin" | "destination">): string {
  const city = (code: string) => placeLabel(code).replace(/\s*\(.*\)$/, "");
  return `${city(m.origin.code)} → ${city(m.destination.code)}`;
}
