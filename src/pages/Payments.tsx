import { TOKEN_NETWORKS } from "@engine/payments.ts";
import { DEMO_CARDS } from "@engine/service.ts";
import type { ChainNetwork, PaymentMethod, StablecoinToken } from "@engine/types.ts";
import { AlertTriangle, Copy, CreditCard, FlaskConical, Loader2, Lock, Plus, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { ModeBadge } from "@/components/ModeBadge";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { useBackend, useData } from "@/hooks/backend";
import { showError } from "@/lib/errors";
import { money, relative } from "@/lib/format";

const LiveCardForm = lazy(() => import("@/components/LiveCardForm").then((m) => ({ default: m.LiveCardForm })));

function WalletCard({ pm }: { pm: PaymentMethod }) {
  const { backend } = useBackend();
  const { data } = useData(async (b) => ({ availability: await b.walletAvailability(pm.id), txs: await b.listWalletTransactions(pm.id) }), [pm.id]);
  const [amount, setAmount] = useState("1200");
  const [busy, setBusy] = useState(false);
  const w = pm.wallet!;
  const network = TOKEN_NETWORKS.find((t) => t.token === w.token && t.network === w.network);
  const a = data?.availability;
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success("Copied"));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> {pm.label}
          </CardTitle>
          <CardDescription>
            {w.token} on {network?.networkLabel ?? w.network} · {w.requiredConfirmations} confirmations required
          </CardDescription>
        </div>
        <ModeBadge mode={pm.mode} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Confirmed balance", a?.confirmed],
            ["Reserved for missions", a?.held],
            ["Available", a?.available],
            ["Pending deposits", a?.pending],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-xl bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-display text-lg font-semibold tabular">{money((v as number) ?? 0, "USD", { decimals: true })}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">1 {w.token} is displayed as 1.00 USD. Pending deposits are never treated as available funds. Funds reserved for an active mission cannot back another mission.</p>

        <div className="space-y-2 rounded-xl border p-4">
          <div className="text-sm font-medium">Deposit details</div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Network</span>
              <span className="font-medium">{network?.networkLabel ?? w.network}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">Token contract</span>
              <button type="button" onClick={() => copy(w.tokenContract)} className="inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:text-foreground">
                <span className="truncate">{w.tokenContract}</span> <Copy className="h-3 w-3 shrink-0" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">Deposit address</span>
              <span className="min-w-0 truncate font-mono text-xs">{w.depositAddress}</span>
            </div>
          </div>
          {pm.mode === "demo" && (
            <Alert variant="warn" className="mt-2">
              <AlertTriangle />
              <AlertDescription>Demo wallet: this deposit address is intentionally invalid. Never send real funds to it.</AlertDescription>
            </Alert>
          )}
        </div>

        {pm.mode === "demo" && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={`dep-${pm.id}`}>Simulate an incoming deposit ({w.token})</Label>
              <Input id={`dep-${pm.id}`} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await backend.simulateDeposit(pm.id, Number(amount));
                  toast.success("Deposit detected — waiting for confirmations");
                } catch (e) {
                  showError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Simulate deposit
            </Button>
          </div>
        )}

        {(data?.txs ?? []).length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">Transactions</div>
            <ul className="divide-y rounded-xl border">
              {data!.txs.slice(0, 8).map((t) => (
                <li key={t.id} className="flex flex-col gap-1.5 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={t.direction === "spend" ? "secondary" : t.status === "confirmed" ? "signal" : "warn"}>{t.direction}</Badge>
                    <span className="font-medium tabular">
                      {t.direction === "spend" ? "−" : "+"}
                      {money(t.amount, "USD", { decimals: true })}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{relative(t.createdAt)}</span>
                  </div>
                  {t.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <Progress value={(t.confirmations / t.requiredConfirmations) * 100} className="h-1.5" indicatorClassName="bg-warn" />
                      <span className="shrink-0 text-xs tabular text-muted-foreground">
                        {t.confirmations}/{t.requiredConfirmations}
                      </span>
                    </div>
                  )}
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{t.txHash}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <RemoveButton pm={pm} />
      </CardContent>
    </Card>
  );
}

function RemoveButton({ pm }: { pm: PaymentMethod }) {
  const { backend } = useBackend();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      onClick={async () => {
        if (!confirm(`Remove ${pm.label}? Agent purchases with it will no longer be authorized.`)) return;
        try {
          await backend.removePaymentMethod(pm.id);
          toast.success("Payment method removed");
        } catch (e) {
          showError(e);
        }
      }}
    >
      <Trash2 /> Remove
    </Button>
  );
}

export default function Payments() {
  const { backend, status } = useBackend();
  const { data: methods } = useData((b) => b.listPaymentMethods(), []);
  const [cardOpen, setCardOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [brand, setBrand] = useState("visa");
  const [tn, setTn] = useState(`${TOKEN_NETWORKS[0].token}:${TOKEN_NETWORKS[0].network}`);
  const [busy, setBusy] = useState(false);
  const demo = status?.mode !== "live";
  const cards = (methods ?? []).filter((m) => m.paymentType === "card");
  const wallets = (methods ?? []).filter((m) => m.paymentType === "stablecoin_wallet");

  return (
    <div>
      <PageHeader title="Payment methods" description="Authorize how FareBuddy may pay. You set the maximum amount per mission." />

      <Alert className="mb-6">
        <ShieldCheck />
        <AlertTitle>How payment works</AlertTitle>
        <AlertDescription>
          Cards are tokenized by a PCI-compliant provider — FareBuddy never stores card numbers or CVVs. A hold is placed only right before booking and captured after the booking provider confirms. Flights may be charged by the airline or booking provider rather than FareBuddy directly.
        </AlertDescription>
      </Alert>

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cards</h2>
          <Button variant="outline" onClick={() => setCardOpen(true)}>
            <Plus /> Add card
          </Button>
        </div>
        {cards.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No cards yet.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <div className="relative bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground">
                <div className="flex items-center justify-between">
                  <CreditCard className="h-6 w-6" />
                  <ModeBadge mode={c.mode} className="bg-primary-foreground/15 text-primary-foreground" />
                </div>
                <div className="mt-8 font-mono text-lg tracking-widest">•••• •••• •••• {c.card?.last4}</div>
                <div className="mt-1 flex justify-between text-xs uppercase text-primary-foreground/70">
                  <span>{c.card?.brand}</span>
                  <span>
                    exp {String(c.card?.expMonth).padStart(2, "0")}/{String(c.card?.expYear).slice(-2)}
                  </span>
                </div>
              </div>
              <CardContent className="flex items-center justify-between p-4">
                <Badge variant={c.authorizationStatus === "active" ? "signal" : "warn"}>
                  <Lock className="h-3 w-3" /> {c.authorizationStatus === "active" ? "Authorized for agent" : c.authorizationStatus}
                </Badge>
                <RemoveButton pm={c} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Stablecoin wallets</h2>
          <Button variant="outline" onClick={() => setWalletOpen(true)}>
            <Plus /> Create wallet
          </Button>
        </div>
        {wallets.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No wallets yet. Pre-fund a USDC or USDT wallet to pay for flights.</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          {wallets.map((w) => (
            <WalletCard key={w.id} pm={w} />
          ))}
        </div>
      </section>

      <Dialog open={cardOpen} onOpenChange={setCardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a card</DialogTitle>
            <DialogDescription>
              {demo ? "Demo mode uses simulated tokenized cards. Never enter a real card number here." : "Card details are entered in Stripe’s secure fields and never touch FareBuddy’s servers."}
            </DialogDescription>
          </DialogHeader>
          {demo ? (
            <>
              <RadioGroup value={brand} onValueChange={setBrand} className="grid gap-2">
                {DEMO_CARDS.map((c) => (
                  <RadioCard key={c.brand} value={c.brand}>
                    <CreditCard className="mt-0.5 h-4 w-4" />
                    <span>
                      <span className="block font-medium">Demo {c.label}</span>
                      <span className="block font-mono text-xs text-muted-foreground">•••• {c.last4} · simulated token</span>
                    </span>
                  </RadioCard>
                ))}
              </RadioGroup>
              <DialogFooter>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await backend.addDemoCard(brand);
                      toast.success("Demo card added");
                      setCardOpen(false);
                    } catch (e) {
                      showError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy && <Loader2 className="animate-spin" />} Add demo card
                </Button>
              </DialogFooter>
            </>
          ) : status?.stripePublishableKey ? (
            <Suspense fallback={<div className="py-6 text-center text-sm text-muted-foreground">Loading secure form…</div>}>
              <LiveCardForm
                publishableKey={status.stripePublishableKey}
                onDone={() => {
                  setCardOpen(false);
                  toast.success("Card saved");
                }}
              />
            </Suspense>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>Live card payments are not configured (missing Stripe publishable key).</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a stablecoin wallet</DialogTitle>
            <DialogDescription>
              {demo
                ? "Demo wallets simulate deposits and confirmations. FareBuddy never asks for private keys."
                : "Live wallets require a configured custody provider."}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={tn} onValueChange={setTn} className="grid gap-2 sm:grid-cols-2">
            {TOKEN_NETWORKS.map((t) => (
              <RadioCard key={`${t.token}:${t.network}`} value={`${t.token}:${t.network}`}>
                <span>
                  <span className="block font-medium">{t.token}</span>
                  <span className="block text-xs text-muted-foreground">{t.networkLabel} · {t.requiredConfirmations} conf.</span>
                </span>
              </RadioCard>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">Sending a token on the wrong network can result in permanent loss. Always match the token and network shown on the wallet.</p>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={async () => {
                const [token, network] = tn.split(":") as [StablecoinToken, ChainNetwork];
                setBusy(true);
                try {
                  await backend.addDemoWallet(token, network);
                  toast.success("Wallet created");
                  setWalletOpen(false);
                } catch (e) {
                  showError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="animate-spin" />} Create wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
