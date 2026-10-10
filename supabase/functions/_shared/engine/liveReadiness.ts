// Determines whether LIVE mode may be enabled. Live mode is only available when
// every required integration is configured; otherwise the app stays in demo.

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

export interface LiveReadiness {
  liveAvailable: boolean;
  checks: ReadinessCheck[];
}

export function evaluateLiveReadiness(env: Record<string, string | undefined>): LiveReadiness {
  const has = (k: string) => !!env[k] && env[k]!.trim().length > 0;
  const checks: ReadinessCheck[] = [
    {
      key: "flag",
      label: "Live booking switch",
      ok: env.LIVE_BOOKING_ENABLED === "true",
      detail: "LIVE_BOOKING_ENABLED=true must be set explicitly by an operator.",
      required: true,
    },
    {
      key: "flights",
      label: "Flight search & booking provider (Duffel)",
      ok: has("DUFFEL_ACCESS_TOKEN") && !env.DUFFEL_ACCESS_TOKEN!.startsWith("duffel_test_"),
      detail: has("DUFFEL_ACCESS_TOKEN")
        ? env.DUFFEL_ACCESS_TOKEN!.startsWith("duffel_test_")
          ? "A Duffel TEST token is configured — test tokens cannot issue real tickets."
          : "Live Duffel token configured. Requires Duffel go-live approval and a funded balance."
        : "DUFFEL_ACCESS_TOKEN is not configured.",
      required: true,
    },
    {
      key: "cards",
      label: "Card payments (Stripe)",
      ok: has("STRIPE_SECRET_KEY") && env.STRIPE_SECRET_KEY!.startsWith("sk_live_"),
      detail: has("STRIPE_SECRET_KEY") ? "Stripe key configured." : "STRIPE_SECRET_KEY is not configured.",
      required: true,
    },
    {
      key: "passenger_key",
      label: "Passenger data encryption key",
      ok: has("PASSENGER_DATA_KEY"),
      detail: has("PASSENGER_DATA_KEY") ? "AES-256-GCM key configured." : "PASSENGER_DATA_KEY is not configured.",
      required: true,
    },
    {
      key: "wallets",
      label: "Stablecoin wallet provider",
      ok: has("WALLET_PROVIDER_API_KEY"),
      detail: has("WALLET_PROVIDER_API_KEY")
        ? "Wallet provider key configured. A provider-specific adapter must still be implemented."
        : "No wallet custody provider configured — stablecoin payments stay simulated.",
      required: false,
    },
    {
      key: "email",
      label: "Email notifications (Resend)",
      ok: has("RESEND_API_KEY"),
      detail: has("RESEND_API_KEY") ? "Booking emails enabled." : "RESEND_API_KEY not set — notifications are in-app only.",
      required: false,
    },
  ];
  return { liveAvailable: checks.filter((c) => c.required).every((c) => c.ok), checks };
}
