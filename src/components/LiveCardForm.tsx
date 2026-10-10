// LIVE card capture using Stripe Elements. Card data goes directly from the
// browser to Stripe (hosted fields); FareBuddy only receives a token.

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/backend";
import { showError } from "@/lib/errors";

function Inner({ setupIntentId, onDone }: { setupIntentId: string; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { backend } = useBackend();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        try {
          const { error } = await stripe.confirmSetup({ elements, redirect: "if_required" });
          if (error) throw new Error(error.message);
          await backend.stripeFinalize(setupIntentId);
          onDone();
        } catch (err) {
          showError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PaymentElement />
      <Button type="submit" className="w-full" disabled={!stripe || busy}>
        {busy && <Loader2 className="animate-spin" />} Save card securely
      </Button>
    </form>
  );
}

export function LiveCardForm({ publishableKey, onDone }: { publishableKey: string; onDone: () => void }) {
  const { backend } = useBackend();
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  const [intent, setIntent] = useState<{ clientSecret: string; setupIntentId: string } | null>(null);
  useEffect(() => {
    backend.stripeSetupIntent().then(setIntent).catch(showError);
  }, [backend]);
  if (!intent) return <div className="py-6 text-center text-sm text-muted-foreground">Connecting to Stripe…</div>;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret }}>
      <Inner setupIntentId={intent.setupIntentId} onDone={onDone} />
    </Elements>
  );
}
