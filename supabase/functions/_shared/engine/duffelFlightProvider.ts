// LIVE flight provider adapter for the Duffel Flights API (https://duffel.com/docs).
//
// Status: implemented against Duffel's documented v2 API shape but NOT verified
// with live credentials in this repository. Before enabling live booking:
//  * obtain a Duffel live access token and complete Duffel's go-live review;
//  * fund the Duffel balance (orders below are paid with `type: "balance"`);
//  * confirm your commercial model allows charging travellers' cards
//    (see StripeCardGateway) and settling with Duffel;
//  * run end-to-end tests in Duffel test mode ("Duffel Airways", code ZZ).

import type {
  CreateOrderInput,
  FlightProvider,
  FlightSearchRequest,
  OrderLookup,
  OrderResult,
} from "./providers.ts";
import { ProviderTimeoutError, ProviderUnavailableError } from "./providers.ts";
import type { CabinClass, Currency, FlightOffer, PassengerCounts, Segment, Slice } from "./types.ts";

const API = "https://api.duffel.com";
const MAX_REQUESTS_PER_SEARCH = 6;

// deno-lint-ignore no-explicit-any
type Json = any;

export class DuffelFlightProvider implements FlightProvider {
  readonly name = "duffel";
  readonly mode = "live" as const;
  readonly capabilities = {
    search: true,
    revalidate: true,
    createOrder: true,
    instantTicketing: true,
    // Duffel cannot look an order up by our key directly; we scan recent orders'
    // metadata. Treated as NOT authoritative, so unknown outcomes escalate to a human.
    reconcileByKey: false,
  };

  constructor(
    private token: string,
    private timeoutMs = 45000,
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Duffel-Version": "v2",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json?.errors?.[0]?.message ?? `Duffel ${method} ${path} failed with ${res.status}`;
        const err = new Error(message) as Error & { status?: number; code?: string };
        err.status = res.status;
        err.code = json?.errors?.[0]?.code;
        throw err;
      }
      return json;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new ProviderTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(req: FlightSearchRequest): Promise<FlightOffer[]> {
    const [out, ret] = req.slices;
    const combos: { o: string; d: string; dep: string; retDate?: string }[] = [];
    for (const dep of out.departureDates)
      for (const o of out.originAirports)
        for (const d of out.destinationAirports)
          for (const retDate of ret ? ret.departureDates : [undefined]) combos.push({ o, d, dep, retDate });
    if (combos.length > MAX_REQUESTS_PER_SEARCH) {
      // Respect rate limits: exact dates first, then the closest flexible dates.
      combos.splice(MAX_REQUESTS_PER_SEARCH);
    }
    const offers: FlightOffer[] = [];
    for (const c of combos) {
      const slices = [{ origin: c.o, destination: c.d, departure_date: c.dep }];
      // Duffel round trips return to the same pair; mixed airports need separate requests.
      if (c.retDate) slices.push({ origin: c.d, destination: c.o, departure_date: c.retDate });
      const json = await this.request("POST", "/air/offer_requests?return_offers=true&supplier_timeout=20000", {
        data: {
          slices,
          passengers: passengerList(req.passengers),
          cabin_class: req.cabin,
          max_connections: Math.min(2, req.maxConnections),
        },
      });
      for (const o of json.data?.offers ?? []) {
        const mapped = mapOffer(o, req.passengers, req.cabin);
        if (mapped) offers.push(mapped);
      }
    }
    return offers;
  }

  async revalidate(offer: FlightOffer): Promise<FlightOffer | null> {
    try {
      const json = await this.request("GET", `/air/offers/${offer.id}`);
      return mapOffer(json.data, offer.passengers, offer.slices[0].segments[0].cabin);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 410 || status === 422) return null;
      throw err;
    }
  }

  async createOrder(input: CreateOrderInput): Promise<OrderResult> {
    const ids = (input.offer.providerData?.passengerIds as string[] | undefined) ?? [];
    if (ids.length !== input.passengers.length) throw new ProviderUnavailableError("Passenger count does not match the offer");
    try {
      const json = await this.request("POST", "/air/orders", {
        data: {
          type: "instant",
          selected_offers: [input.offer.id],
          passengers: input.passengers.map((p, i) => ({
            id: ids[i],
            given_name: p.givenName,
            family_name: p.familyName,
            born_on: p.dateOfBirth,
            gender: p.gender === "female" ? "f" : "m",
            title: p.gender === "female" ? "ms" : "mr",
            email: p.email,
            phone_number: p.phone,
            identity_documents: [
              {
                type: "passport",
                unique_identifier: p.passportNumber,
                issuing_country_code: p.passportIssuingCountry,
                expires_on: p.passportExpiry,
              },
            ],
          })),
          payments: [{ type: "balance", amount: input.amount.toFixed(2), currency: input.currency }],
          metadata: { idempotency_key: input.idempotencyKey },
        },
      });
      return mapOrder(json.data);
    } catch (err) {
      if (err instanceof ProviderTimeoutError) throw err;
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        return { status: "failed", reason: (err as Error).message, retryable: status === 409 || status === 422 };
      }
      // 5xx / network: outcome unknown.
      throw new ProviderTimeoutError(`Uncertain Duffel response: ${(err as Error).message}`);
    }
  }

  async findOrder(idempotencyKey: string, providerReference: string | null): Promise<OrderLookup> {
    if (providerReference) {
      const json = await this.request("GET", `/air/orders/${providerReference}`);
      return mapOrder(json.data);
    }
    const json = await this.request("GET", "/air/orders?limit=50");
    const match = (json.data ?? []).find((o: Json) => o.metadata?.idempotency_key === idempotencyKey);
    return match ? mapOrder(match) : { status: "not_found" };
  }
}

function passengerList(p: PassengerCounts) {
  return [
    ...Array.from({ length: p.adults }, () => ({ type: "adult" })),
    ...Array.from({ length: p.children }, () => ({ age: 8 })),
    ...Array.from({ length: p.infants }, () => ({ type: "infant_without_seat" })),
  ];
}

function isoDurationToMinutes(d: string | null | undefined): number {
  if (!d) return 0;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
}

function mapOffer(o: Json, passengers: PassengerCounts, cabin: CabinClass): FlightOffer | null {
  if (!o?.id || !o.slices) return null;
  let minBags = Infinity;
  const slices: Slice[] = o.slices.map((s: Json) => {
    const segments: Segment[] = s.segments.map((seg: Json) => {
      for (const sp of seg.passengers ?? []) {
        const checked = (sp.baggages ?? []).filter((b: Json) => b.type === "checked").reduce((n: number, b: Json) => n + (b.quantity ?? 0), 0);
        minBags = Math.min(minBags, checked);
      }
      return {
        marketingCarrier: seg.marketing_carrier?.iata_code ?? "",
        operatingCarrier: seg.operating_carrier?.iata_code ?? seg.marketing_carrier?.iata_code ?? "",
        flightNumber: `${seg.marketing_carrier?.iata_code ?? ""} ${seg.marketing_carrier_flight_number ?? ""}`.trim(),
        origin: seg.origin?.iata_code,
        destination: seg.destination?.iata_code,
        departureAt: String(seg.departing_at).slice(0, 19),
        arrivalAt: String(seg.arriving_at).slice(0, 19),
        durationMinutes: isoDurationToMinutes(seg.duration),
        aircraft: seg.aircraft?.name ?? "",
        cabin: (seg.passengers?.[0]?.cabin_class as CabinClass) ?? cabin,
      };
    });
    return {
      origin: s.origin?.iata_code,
      destination: s.destination?.iata_code,
      departureAt: segments[0].departureAt,
      arrivalAt: segments[segments.length - 1].arrivalAt,
      durationMinutes: isoDurationToMinutes(s.duration),
      segments,
    };
  });
  return {
    id: o.id,
    provider: "duffel",
    mode: "live",
    totalAmount: Number(o.total_amount),
    baseAmount: Number(o.base_amount ?? 0),
    taxAmount: Number(o.tax_amount ?? 0),
    currency: o.total_currency as Currency,
    slices,
    owner: o.owner?.iata_code ?? "",
    passengers,
    includedCheckedBagsPerPassenger: Number.isFinite(minBags) ? minBags : 0,
    // Adding paid bags requires Duffel "available_services"; not supported yet, so
    // offers without enough included bags are treated as ineligible.
    extraBagPrice: null,
    fareBrand: o.slices?.[0]?.fare_brand_name ?? "",
    refundable: !!o.conditions?.refund_before_departure?.allowed,
    expiresAt: o.expires_at,
    providerData: { passengerIds: (o.passengers ?? []).map((p: Json) => p.id) },
  };
}

function mapOrder(o: Json): OrderResult {
  if (!o) return { status: "pending", providerReference: null, message: "Empty order response" };
  if (o.cancelled_at) return { status: "failed", reason: "Order was cancelled", retryable: false };
  const tickets = (o.documents ?? []).filter((d: Json) => d.type === "electronic_ticket").map((d: Json) => d.unique_identifier);
  if (!o.booking_reference) return { status: "pending", providerReference: o.id ?? null, message: "Order created, awaiting airline reference" };
  return {
    status: "confirmed",
    providerReference: o.id,
    airlineReference: o.booking_reference,
    ticketingStatus: tickets.length > 0 ? "issued" : "pending",
    ticketNumbers: tickets,
    totalAmount: Number(o.total_amount),
    currency: o.total_currency,
    message: "Confirmed by Duffel",
    documents: [],
  };
}
