// Payment gateways. Cards are held (authorized) before the order is submitted,
// captured only after the booking provider confirms, and released on failure.

import type { AuthorizePaymentInput, AuthorizeResult, PaymentGateway } from "./providers.ts";
import type { EngineStore } from "./store.ts";
import type { ChainNetwork, Currency, StablecoinToken } from "./types.ts";
import { hashString } from "./util.ts";

/** DEMO card gateway — simulates holds and captures. No money moves. */
export class DemoCardGateway implements PaymentGateway {
  readonly name = "demo-card";
  readonly mode = "demo" as const;

  async authorize(input: AuthorizePaymentInput): Promise<AuthorizeResult> {
    if (input.paymentMethod.paymentType !== "card") return { status: "declined", reason: "Not a card payment method" };
    if (input.paymentMethod.authorizationStatus !== "active") return { status: "declined", reason: "Card is not authorized for agent purchases" };
    if (input.demoOutcome === "payment_declined") return { status: "declined", reason: "DEMO: the issuer declined the simulated charge" };
    return { status: "authorized", reference: `demo_hold_${hashString(input.idempotencyKey)}` };
  }
  async capture(): Promise<void> {}
  async release(): Promise<void> {}
}

/**
 * Wallet gateway. Funds are earmarked per mission when monitoring is activated
 * (a reservation), so the same balance can never back two missions at once.
 * Works with both the demo ledger and a live custody provider's ledger.
 */
export class WalletGateway implements PaymentGateway {
  readonly name = "stablecoin-wallet";
  constructor(
    private store: EngineStore,
    readonly mode: "demo" | "live",
  ) {}

  async authorize(input: AuthorizePaymentInput): Promise<AuthorizeResult> {
    const pm = input.paymentMethod;
    if (pm.paymentType !== "stablecoin_wallet") return { status: "declined", reason: "Not a wallet payment method" };
    if (input.demoOutcome === "payment_declined") return { status: "declined", reason: "DEMO: simulated wallet settlement failure" };
    const reservation = await this.store.getHeldReservation(input.missionId, pm.id);
    if (!reservation) return { status: "declined", reason: "No funds are reserved for this mission" };
    if (reservation.amount + 1e-9 < input.amount)
      return { status: "declined", reason: `Reserved ${reservation.amount} ${pm.currency} is below the ${input.amount} ${input.currency} price` };
    return { status: "authorized", reference: reservation.id };
  }

  async capture(reference: string, amount: number): Promise<void> {
    await this.store.captureReservation(reference, amount);
  }

  /** Keep the reservation held: the mission may still buy a later offer. */
  async release(): Promise<void> {}
}

/**
 * LIVE card gateway using Stripe PaymentIntents with manual capture and
 * off-session confirmation. Requires STRIPE_SECRET_KEY, a saved Stripe customer
 * + payment method (SetupIntent with off_session usage), and a commercial setup
 * where FareBuddy is permitted to charge travellers (merchant of record or
 * similar). Not exercised against live credentials in this repository.
 */
export class StripeCardGateway implements PaymentGateway {
  readonly name = "stripe";
  readonly mode = "live" as const;
  constructor(private secretKey: string) {}

  private async call(path: string, params: Record<string, string>, idempotencyKey?: string) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: new URLSearchParams(params),
    });
    const body = await res.json();
    return { ok: res.ok, body };
  }

  async authorize(input: AuthorizePaymentInput): Promise<AuthorizeResult> {
    const pm = input.paymentMethod;
    if (!pm.providerReference || !pm.tokenOrWalletReference) return { status: "declined", reason: "Card is missing provider references" };
    const { ok, body } = await this.call(
      "payment_intents",
      {
        amount: String(toMinorUnits(input.amount, input.currency)),
        currency: input.currency.toLowerCase(),
        customer: pm.providerReference,
        payment_method: pm.tokenOrWalletReference,
        off_session: "true",
        confirm: "true",
        capture_method: "manual",
        "metadata[mission_id]": input.missionId,
        "metadata[idempotency_key]": input.idempotencyKey,
      },
      `auth_${input.idempotencyKey}`,
    );
    if (ok && body.status === "requires_capture") return { status: "authorized", reference: body.id };
    if (body?.status === "requires_action" || body?.error?.code === "authentication_required")
      return { status: "requires_action", reason: "The card issuer requires the traveller to authenticate this payment" };
    return { status: "declined", reason: body?.error?.message ?? `Unexpected PaymentIntent status ${body?.status}` };
  }

  async capture(reference: string, amount: number, currency: Currency): Promise<void> {
    const { ok, body } = await this.call(`payment_intents/${reference}/capture`, { amount_to_capture: String(toMinorUnits(amount, currency)) }, `cap_${reference}`);
    if (!ok) throw new Error(body?.error?.message ?? "Stripe capture failed");
  }

  async release(reference: string): Promise<void> {
    await this.call(`payment_intents/${reference}/cancel`, {}, `cancel_${reference}`);
  }
}

export function toMinorUnits(amount: number, currency: Currency): number {
  return currency === "JPY" ? Math.round(amount) : Math.round(amount * 100);
}

// ---------------------------------------------------------------------------
// Stablecoin network reference data.
// Contract addresses are the issuers' canonical deployments. Verify against
// Circle / Tether documentation before enabling live deposits.

export interface TokenNetwork {
  token: StablecoinToken;
  network: ChainNetwork;
  networkLabel: string;
  contract: string;
  requiredConfirmations: number;
}

export const TOKEN_NETWORKS: TokenNetwork[] = [
  { token: "USDC", network: "base", networkLabel: "Base", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", requiredConfirmations: 12 },
  { token: "USDC", network: "ethereum", networkLabel: "Ethereum", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", requiredConfirmations: 12 },
  { token: "USDC", network: "polygon", networkLabel: "Polygon PoS", contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", requiredConfirmations: 64 },
  { token: "USDC", network: "solana", networkLabel: "Solana", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", requiredConfirmations: 32 },
  { token: "USDT", network: "ethereum", networkLabel: "Ethereum", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", requiredConfirmations: 12 },
  { token: "USDT", network: "tron", networkLabel: "Tron (TRC-20)", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", requiredConfirmations: 20 },
  { token: "USDT", network: "polygon", networkLabel: "Polygon PoS", contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", requiredConfirmations: 64 },
];

export function tokenNetwork(token: StablecoinToken, network: ChainNetwork): TokenNetwork | undefined {
  return TOKEN_NETWORKS.find((t) => t.token === token && t.network === network);
}

/**
 * DEMO deposit address. Deliberately NOT a valid address on any chain so funds
 * can never be sent to it by mistake.
 */
export function demoDepositAddress(seed: string): string {
  return `DEMO-NOT-A-REAL-ADDRESS-${hashString(seed).toUpperCase()}`;
}
