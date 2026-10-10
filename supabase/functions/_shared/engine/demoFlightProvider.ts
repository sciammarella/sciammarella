// DEMO flight provider. Generates realistic-looking but entirely SIMULATED offers.
// Nothing produced here is a real fare, a real seat or a real booking.

import { AIRLINES, type Airline, getAirline } from "./airlines.ts";
import { AIRPORTS, type Airport, distanceKm, getAirport } from "./airports.ts";
import type {
  CreateOrderInput,
  FlightProvider,
  FlightSearchRequest,
  OrderLookup,
  OrderResult,
  ProviderStateStore,
} from "./providers.ts";
import { MemoryStateStore, ProviderTimeoutError } from "./providers.ts";
import type { CabinClass, Currency, FlightOffer, PassengerCounts, Segment, Slice } from "./types.ts";
import { createRng, hashString, type Rng, roundMoney } from "./util.ts";

/** Demo-only FX table (units of currency per 1 USD). Not live market rates. */
export const DEMO_FX_PER_USD: Record<Currency, number> = { USD: 1, EUR: 0.92, GBP: 0.79, BRL: 5.4, JPY: 148 };

const CABIN_MULTIPLIER: Record<CabinClass, number> = { economy: 1, premium_economy: 1.75, business: 3.6, first: 6.4 };
const STOP_FACTOR = [1.18, 1.0, 0.9, 0.86];
const DEPARTURE_SLOTS = ["06:15", "08:40", "10:05", "11:50", "13:30", "15:55", "18:20", "20:10", "21:45", "23:10"];

interface Edge {
  to: string;
  carrier: string;
  distance: number;
}

const MAX_RANGE: Record<string, number> = { G3: 6500, AD: 7500, CM: 6500, AR: 11000, TP: 8500, AM: 12000, LA: 12000, AC: 13000, IB: 11000 };

let GRAPH: Map<string, Edge[]> | null = null;

function graph(): Map<string, Edge[]> {
  if (GRAPH) return GRAPH;
  const g = new Map<string, Edge[]>();
  const add = (from: Airport, to: Airport, carrier: string) => {
    if (from.code === to.code) return;
    const list = g.get(from.code) ?? [];
    if (!list.some((e) => e.to === to.code && e.carrier === carrier)) {
      list.push({ to: to.code, carrier, distance: distanceKm(from, to) });
      g.set(from.code, list);
    }
  };
  for (const airline of AIRLINES) {
    const range = MAX_RANGE[airline.code] ?? 15000;
    for (const hubCode of airline.hubs) {
      const hub = getAirport(hubCode)!;
      for (const other of AIRPORTS) {
        if (other.code === hub.code) continue;
        const d = distanceKm(hub, other);
        const domestic = airline.domesticCountry && other.countryCode === airline.domesticCountry && hub.countryCode === airline.domesticCountry;
        const longHaulOk = d <= 4000 || hub.size === 3 || other.size === 3;
        if (domestic || (other.size >= 2 && d <= range && d > 250 && longHaulOk)) {
          add(hub, other, airline.code);
          add(other, hub, airline.code);
        }
      }
    }
  }
  GRAPH = g;
  return g;
}

interface Path {
  legs: { from: string; to: string; carrier: string; distance: number }[];
  distance: number;
}

function findPaths(origin: string, destination: string, maxStops: number, limit = 10): Path[] {
  const g = graph();
  const o = getAirport(origin);
  const d = getAirport(destination);
  if (!o || !d || origin === destination) return [];
  const direct = distanceKm(o, d);
  const maxDetour = direct > 3000 ? 1.5 : 2.4;
  const results: Path[] = [];
  const maxLegs = Math.min(3, maxStops + 1);

  const walk = (at: string, legs: Path["legs"], visited: Set<string>, dist: number) => {
    if (legs.length > maxLegs) return;
    if (at === destination && legs.length > 0) {
      results.push({ legs: [...legs], distance: dist });
      return;
    }
    if (legs.length === maxLegs) return;
    for (const e of g.get(at) ?? []) {
      if (visited.has(e.to)) continue;
      const next = getAirport(e.to)!;
      const remaining = distanceKm(next, d);
      if (dist + e.distance + remaining > direct * maxDetour) continue;
      visited.add(e.to);
      legs.push({ from: at, to: e.to, carrier: e.carrier, distance: e.distance });
      walk(e.to, legs, visited, dist + e.distance);
      legs.pop();
      visited.delete(e.to);
    }
  };
  walk(origin, [], new Set([origin]), 0);

  // De-duplicate by airport sequence + main carrier, prefer shorter routings and fewer legs.
  // Keep at most two routings per main carrier so results stay diverse.
  const seen = new Set<string>();
  const perCarrier = new Map<string, number>();
  return results
    .sort((a, b) => a.legs.length - b.legs.length || a.distance - b.distance)
    .filter((p) => {
      const main = mainCarrier(p);
      const mainKey = p.legs.map((l) => l.to).join("|") + main;
      if (seen.has(mainKey) || (perCarrier.get(main) ?? 0) >= 2) return false;
      seen.add(mainKey);
      perCarrier.set(main, (perCarrier.get(main) ?? 0) + 1);
      return true;
    })
    .slice(0, limit);
}

function mainCarrier(p: Path): string {
  return [...p.legs].sort((a, b) => b.distance - a.distance)[0].carrier;
}

// ---- time helpers (local times without offsets) ---------------------------

function localToUtcMs(localIso: string, offsetHours: number): number {
  return Date.parse(`${localIso}Z`) - offsetHours * 3600000;
}
function utcMsToLocal(ms: number, offsetHours: number): string {
  return new Date(ms + offsetHours * 3600000).toISOString().slice(0, 19);
}
function round5(n: number) {
  return Math.round(n / 5) * 5;
}

function buildSlice(path: Path, date: string, slot: string, cabin: CabinClass, rng: Rng): Slice {
  const segments: Segment[] = [];
  let cursorUtc = localToUtcMs(`${date}T${slot}:00`, getAirport(path.legs[0].from)!.utcOffset);
  for (let i = 0; i < path.legs.length; i++) {
    const leg = path.legs[i];
    const from = getAirport(leg.from)!;
    const to = getAirport(leg.to)!;
    if (i > 0) {
      const connection = round5(rng.range(70, 330));
      cursorUtc += connection * 60000;
      // Snap to a 5-minute boundary for realistic schedules.
      cursorUtc = Math.ceil(cursorUtc / 300000) * 300000;
    }
    const duration = round5(25 + (leg.distance / 830) * 60);
    const airline = getAirline(leg.carrier)!;
    const longHaul = leg.distance > 4000;
    const flightNo = 100 + (parseInt(hashString(`${leg.carrier}${leg.from}${leg.to}${slot}`).slice(-4), 36) % (longHaul ? 900 : 8900));
    const depUtc = cursorUtc;
    const arrUtc = depUtc + duration * 60000;
    segments.push({
      marketingCarrier: leg.carrier,
      operatingCarrier: leg.carrier,
      flightNumber: `${leg.carrier} ${flightNo}`,
      origin: from.code,
      destination: to.code,
      departureAt: utcMsToLocal(depUtc, from.utcOffset),
      arrivalAt: utcMsToLocal(arrUtc, to.utcOffset),
      durationMinutes: duration,
      aircraft: rng.pick(longHaul ? airline.longHaulAircraft : airline.shortHaulAircraft),
      cabin,
    });
    cursorUtc = arrUtc;
  }
  const first = segments[0];
  const last = segments[segments.length - 1];
  const startUtc = localToUtcMs(first.departureAt, getAirport(first.origin)!.utcOffset);
  return {
    origin: first.origin,
    destination: last.destination,
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    durationMinutes: Math.round((cursorUtc - startUtc) / 60000),
    segments,
  };
}

function slicePriceUsd(path: Path, slot: string, date: string, cabin: CabinClass): number {
  const levels = path.legs.map((l) => getAirline(l.carrier)!.priceLevel);
  const level = levels.reduce((a, b) => a + b, 0) / levels.length;
  const hour = parseInt(slot.slice(0, 2), 10);
  const todFactor = hour < 7 || hour >= 22 ? 0.95 : hour >= 17 ? 1.03 : 1;
  const dateFactor = 0.93 + createRng(`date:${date}`).next() * 0.14;
  return (120 + path.distance * 0.041) * level * STOP_FACTOR[path.legs.length - 1] * CABIN_MULTIPLIER[cabin] * todFactor * dateFactor;
}

function paxFactor(p: PassengerCounts) {
  return p.adults + p.children * 0.75 + p.infants * 0.1;
}

function marketFactor(seed: string, tick: number): number {
  const phase = createRng(`phase:${seed}`).range(0, Math.PI * 2);
  const noise = (createRng(`noise:${seed}:${tick}`).next() - 0.5) * 0.1;
  const drift = Math.min(0.1, tick * 0.006);
  return 1 + 0.08 * Math.sin(0.55 * tick + phase) + noise - drift;
}

/** Occasionally one airline runs a sale for a single tick. */
function saleCarrier(seed: string, tick: number, carriers: string[]): { carrier: string; factor: number } | null {
  const rng = createRng(`sale:${seed}:${tick}`);
  if (!rng.chance(0.07) || carriers.length === 0) return null;
  return { carrier: rng.pick(carriers), factor: rng.range(0.68, 0.8) };
}

type Brand = { name: string; factor: number; bags: (a: Airline) => number; extraBag: number | null; refundable: boolean };
const BRANDS: Brand[] = [
  { name: "Light", factor: 0.9, bags: () => 0, extraBag: 65, refundable: false },
  { name: "Standard", factor: 1, bags: (a) => Math.max(1, a.standardBags), extraBag: 55, refundable: false },
  { name: "Flex", factor: 1.28, bags: (a) => Math.max(2, a.standardBags), extraBag: 55, refundable: true },
];

interface StoredOrder {
  idempotencyKey: string;
  result: OrderResult;
  ticketingPolls: number;
  passengerCount: number;
}

export class DemoFlightProvider implements FlightProvider {
  readonly name = "farebuddy-demo";
  readonly mode = "demo" as const;
  readonly capabilities = { search: true, revalidate: true, createOrder: true, instantTicketing: true, reconcileByKey: true };
  private offers = new Map<string, FlightOffer>();

  constructor(
    private state: ProviderStateStore = new MemoryStateStore(),
    private clock: () => Date = () => new Date(),
  ) {}

  async search(req: FlightSearchRequest): Promise<FlightOffer[]> {
    const seed = req.demo?.seed ?? req.missionId;
    const tick = req.demo?.tick ?? 0;
    const fx = DEMO_FX_PER_USD[req.currency] ?? 1;
    const maxStops = Math.min(2, req.maxConnections);

    const sliceOptions = req.slices.map((s, sliceIndex) => {
      const opts: { slice: Slice; priceUsd: number; path: Path; key: string }[] = [];
      const dates = s.departureDates.slice(0, 7);
      const variantsPerPath = dates.length > 3 ? 1 : 2;
      for (const date of dates) {
        for (const o of s.originAirports) {
          for (const d of s.destinationAirports) {
            for (const path of findPaths(o, d, maxStops, 10)) {
              const rng = createRng(`${seed}:${sliceIndex}:${date}:${path.legs.map((l) => l.from + l.carrier).join("")}`);
              const slots = [...DEPARTURE_SLOTS].sort(() => rng.next() - 0.5).slice(0, variantsPerPath);
              for (const slot of slots) {
                const slice = buildSlice(path, date, slot, req.cabin, rng);
                const key = `${slice.segments.map((x) => x.flightNumber + x.departureAt).join("|")}`;
                opts.push({ slice, priceUsd: slicePriceUsd(path, slot, date, req.cabin), path, key });
              }
            }
          }
        }
      }
      return opts.sort((a, b) => a.priceUsd - b.priceUsd).slice(0, 24);
    });

    if (sliceOptions.some((o) => o.length === 0)) return [];

    const allCarriers = [...new Set(sliceOptions.flat().map((o) => mainCarrier(o.path)))];
    const sale = saleCarrier(seed, tick, allCarriers);
    const market = marketFactor(seed, tick);
    const pf = paxFactor(req.passengers);
    const expiresAt = new Date(this.clock().getTime() + 30 * 60000).toISOString();

    const combos: (typeof sliceOptions)[number][number][][] = [];
    if (sliceOptions.length === 1) {
      for (const out of sliceOptions[0]) combos.push([out]);
    } else {
      const returns = sliceOptions[1];
      for (const out of sliceOptions[0]) {
        const carrier = mainCarrier(out.path);
        const mirror = returns.find((r) => mainCarrier(r.path) === carrier) ?? returns[0];
        const alt = returns[createRng(`alt:${out.key}`).int(0, returns.length - 1)];
        combos.push([out, mirror]);
        if (alt !== mirror) combos.push([out, alt]);
      }
    }

    const offers: FlightOffer[] = [];
    for (const combo of combos) {
      const owner = mainCarrier(combo[0].path);
      const airline = getAirline(owner)!;
      const baseUsd = combo.reduce((sum, c) => sum + c.priceUsd, 0);
      const comboKey = combo.map((c) => c.key).join("//");
      const brandRng = createRng(`brand:${comboKey}`);
      const brands = req.cabin === "economy" ? [BRANDS[0], BRANDS[1], ...(brandRng.chance(0.35) ? [BRANDS[2]] : [])] : [BRANDS[1], BRANDS[2]];
      for (const brand of brands) {
        const jitter = 1 + (createRng(`jit:${comboKey}:${brand.name}:${tick}`).next() - 0.5) * 0.08;
        const saleFactor = sale && combo.some((c) => mainCarrier(c.path) === sale.carrier) ? sale.factor : 1;
        const totalUsd = baseUsd * brand.factor * market * jitter * saleFactor * pf;
        const total = roundMoney(totalUsd * fx, req.currency);
        const tax = roundMoney(total * 0.21, req.currency);
        const id = `demo_off_${hashString(`${comboKey}:${brand.name}:${tick}:${req.missionId}`)}`;
        offers.push({
          id,
          provider: this.name,
          mode: "demo",
          totalAmount: total,
          baseAmount: roundMoney(total - tax, req.currency),
          taxAmount: tax,
          currency: req.currency,
          slices: combo.map((c) => c.slice),
          owner,
          passengers: { ...req.passengers },
          includedCheckedBagsPerPassenger: brand.bags(airline),
          extraBagPrice: brand.extraBag === null ? null : roundMoney(brand.extraBag * fx, req.currency),
          fareBrand: `${airline.name} ${brand.name}`,
          refundable: brand.refundable,
          expiresAt,
        });
      }
    }

    // Demo control: a one-shot "flash sale" on the best matching itinerary.
    const flash = req.demo?.flashSaleAmount;
    if (flash && flash > 0) {
      const candidates = offers
        .filter((o) => (req.demo?.isEligible ? req.demo.isEligible({ ...o, totalAmount: flash }) : true))
        .sort((a, b) => a.totalAmount - b.totalAmount);
      const pick = candidates[0];
      if (pick) {
        pick.totalAmount = roundMoney(flash, req.currency);
        pick.taxAmount = roundMoney(flash * 0.21, req.currency);
        pick.baseAmount = roundMoney(flash - pick.taxAmount, req.currency);
        pick.fareBrand = `${pick.fareBrand} · Flash sale (simulated)`;
      }
    }

    for (const o of offers) this.offers.set(o.id, o);
    return offers;
  }

  async revalidate(offer: FlightOffer, _req: FlightSearchRequest): Promise<FlightOffer | null> {
    const known = this.offers.get(offer.id);
    if (!known) return null;
    if (Date.parse(known.expiresAt) < this.clock().getTime()) return null;
    return { ...known };
  }

  /** Apply demo outcome side effects that happen at revalidation time. */
  applyRevalidationOutcome(offer: FlightOffer | null, outcome: string | undefined): FlightOffer | null {
    if (!offer) return null;
    if (outcome === "offer_gone") {
      this.offers.delete(offer.id);
      return null;
    }
    if (outcome === "price_jump") {
      const jumped = { ...offer, totalAmount: roundMoney(offer.totalAmount * 1.14, offer.currency) };
      this.offers.set(offer.id, jumped);
      return jumped;
    }
    return offer;
  }

  async createOrder(input: CreateOrderInput): Promise<OrderResult> {
    const key = `order:${input.idempotencyKey}`;
    const existing = await this.state.get<StoredOrder>(key);
    if (existing) return existing.result;

    const outcome = input.demoOutcome ?? "success";
    const rng = createRng(`order:${input.idempotencyKey}`);
    const confirmed = (ticketing: "issued" | "pending"): OrderResult => ({
      status: "confirmed",
      providerReference: `demo_ord_${hashString(input.idempotencyKey).slice(0, 10)}`,
      airlineReference: Array.from({ length: 6 }, () => rng.pick("ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""))).join(""),
      ticketingStatus: ticketing,
      ticketNumbers:
        ticketing === "issued"
          ? input.passengers.map(() => `000-${String(rng.int(1000000000, 9999999999))}`)
          : [],
      totalAmount: input.amount,
      currency: input.currency,
      message: "DEMO: simulated provider confirmation. No real reservation exists.",
      documents: [],
    });

    let result: OrderResult;
    switch (outcome) {
      case "timeout_then_confirmed":
        await this.state.set<StoredOrder>(key, { idempotencyKey: input.idempotencyKey, result: confirmed("issued"), ticketingPolls: 0, passengerCount: input.passengers.length });
        throw new ProviderTimeoutError("DEMO: simulated timeout while submitting the order");
      case "timeout_then_failed":
        await this.state.set<StoredOrder>(key, {
          idempotencyKey: input.idempotencyKey,
          result: { status: "failed", reason: "DEMO: fare class sold out during ticketing", retryable: true },
          ticketingPolls: 0,
          passengerCount: input.passengers.length,
        });
        throw new ProviderTimeoutError("DEMO: simulated timeout while submitting the order");
      case "pending_ticketing":
        result = confirmed("pending");
        break;
      default:
        result = confirmed("issued");
    }
    await this.state.set<StoredOrder>(key, { idempotencyKey: input.idempotencyKey, result, ticketingPolls: 0, passengerCount: input.passengers.length });
    return result;
  }

  async findOrder(idempotencyKey: string): Promise<OrderLookup> {
    const key = `order:${idempotencyKey}`;
    const stored = await this.state.get<StoredOrder>(key);
    if (!stored) return { status: "not_found" };
    // Simulate ticket issuance completing after one status poll.
    if (stored.result.status === "confirmed" && stored.result.ticketingStatus === "pending") {
      stored.ticketingPolls += 1;
      if (stored.ticketingPolls >= 1) {
        const rng = createRng(`tkt:${idempotencyKey}`);
        stored.result = {
          ...stored.result,
          ticketingStatus: "issued",
          ticketNumbers: Array.from({ length: Math.max(1, stored.passengerCount) }, () => `000-${String(rng.int(1000000000, 9999999999))}`),
          message: "DEMO: simulated ticket issuance completed.",
        };
      }
      await this.state.set(key, stored);
    }
    return stored.result;
  }
}
