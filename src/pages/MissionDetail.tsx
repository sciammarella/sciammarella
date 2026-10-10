import { checkAuthorization } from "@engine/authorization.ts";
import { MONITORING_INTERVALS } from "@engine/mission.ts";
import { spendingCeiling } from "@engine/selection.ts";
import type { DemoOutcome, FlightMission } from "@engine/types.ts";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  FileWarning,
  FlaskConical,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  TrendingDown,
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Itinerary } from "@/components/Itinerary";
import { ModeBadge } from "@/components/ModeBadge";
import { Money } from "@/components/Money";
import { paxCount } from "@/components/MissionCard";
import { PageHeader } from "@/components/PageHeader";
import { PriceChart } from "@/components/PriceChart";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackend, useData, useTicker } from "@/hooks/backend";
import { showError } from "@/lib/errors";
import { carriers, dateLabel, dateTime, duration, money, relative, stopsLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const OUTCOMES: { value: DemoOutcome; label: string }[] = [
  { value: "success", label: "Success — ticket issued" },
  { value: "pending_ticketing", label: "Confirmed, ticketing pending" },
  { value: "timeout_then_confirmed", label: "Timeout → reconciled as confirmed" },
  { value: "timeout_then_failed", label: "Timeout → reconciled as failed" },
  { value: "offer_gone", label: "Offer disappears at revalidation" },
  { value: "price_jump", label: "Price jumps above limit at revalidation" },
  { value: "payment_declined", label: "Payment declined" },
];

function Stat({ label, children, hint, accent }: { label: string; children: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display text-xl font-semibold tabular", accent && "text-signal")}>{children}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function DemoControls({ mission, onRun }: { mission: FlightMission; onRun: () => Promise<void> }) {
  const { backend } = useBackend();
  const [outcome, setOutcome] = useState<DemoOutcome>(mission.demoControls?.nextOutcome ?? "success");
  const [busy, setBusy] = useState(false);
  const active = ["monitoring", "target_reached", "booking_failed"].includes(mission.monitoringStatus);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-demo/30 bg-demo-soft/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-demo" /> Demo simulation controls
        </CardTitle>
        <CardDescription>Drive the simulated market and booking provider to see every workflow branch.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="outcome">Next booking outcome</Label>
          <Select
            id="outcome"
            value={outcome}
            onChange={(e) => {
              const v = e.target.value as DemoOutcome;
              setOutcome(v);
              void run(() => backend.setDemoControls(mission.id, { nextOutcome: v }));
            }}
          >
            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy || !active}
          onClick={() =>
            run(async () => {
              const amount = Math.round(mission.targetPrice * 0.96 * 100) / 100;
              await backend.setDemoControls(mission.id, { flashSaleAmount: amount, nextOutcome: outcome });
              await onRun();
            })
          }
        >
          {busy ? <Loader2 className="animate-spin" /> : <TrendingDown />}
          Simulate fare drop to {money(Math.round(mission.targetPrice * 0.96 * 100) / 100, mission.currency)} & check
        </Button>
        {!active && <p className="text-xs text-muted-foreground">Activate or resume the mission to use the simulation.</p>}
      </CardContent>
    </Card>
  );
}

export default function MissionDetail() {
  useTicker(10000);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { backend } = useBackend();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const { data, loading } = useData(
    async (b) => {
      const mission = await b.getMission(id);
      if (!mission) return null;
      const [observations, attempts, audit, payments, passengers, booking, docs] = await Promise.all([
        b.listObservations(id),
        b.listAttempts(id),
        b.listAudit(id, 300),
        b.listPaymentMethods(),
        b.listPassengers(),
        b.listBookings().then((list) => list.find((x) => x.missionId === id && x.bookingStatus === "confirmed") ?? null),
        b.documentChecks(id).catch(() => []),
      ]);
      return { mission, observations, attempts, audit, payments, passengers, booking, docs };
    },
    [id],
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Mission not found.</p>
        <Button asChild variant="link">
          <Link to="/app/missions">Back to missions</Link>
        </Button>
      </div>
    );
  }

  const { mission: m, observations, attempts, audit, payments, passengers, booking, docs } = data;
  const best = m.bestOffer?.totalAmount ?? null;
  const diff = best !== null ? best - m.targetPrice : null;
  const pm = payments.find((p) => p.id === m.paymentMethodId) ?? null;
  const auth = m.purchaseAuthorization;
  const authCheck = checkAuthorization(m);
  const paxNames = passengers.filter((p) => m.passengerProfileIds.includes(p.id)).map((p) => p.displayName);
  const canPause = ["monitoring", "target_reached", "action_required", "booking_failed"].includes(m.monitoringStatus);
  const canCheck = ["monitoring", "target_reached", "booking_failed", "booking_in_progress"].includes(m.monitoringStatus);
  const canEdit = ["draft", "monitoring", "target_reached", "action_required", "paused", "booking_failed"].includes(m.monitoringStatus);
  const canCancel = !["booked", "booking_in_progress", "cancelled", "expired"].includes(m.monitoringStatus);
  const needsApproval = m.monitoringStatus === "target_reached" && auth && !auth.autoPurchase && authCheck.valid;
  const needsActivation = m.monitoringStatus === "draft" || (m.monitoringStatus === "action_required" && !authCheck.valid);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res && typeof res === "object" && "message" in res && "action" in res) {
        const r = res as { action: string; message: string };
        const ok = ["booked", "checked", "target_reached"].includes(r.action);
        (ok ? toast.success : toast.message)(r.action === "booked" ? (m.mode === "demo" ? "DEMO booking confirmed" : "Booking confirmed") : r.message);
      } else if (success) toast.success(success);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to="/app/missions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Missions
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {m.title}
            <StatusBadge status={m.monitoringStatus} />
            <ModeBadge mode={m.mode} />
          </span>
        }
        description={`${dateLabel(m.departureDate)}${m.returnDate ? ` → ${dateLabel(m.returnDate)}` : " · one way"} · ${paxCount(m)} passenger${paxCount(m) > 1 ? "s" : ""} · ${m.preferences.cabin.replace("_", " ")}`}
        actions={
          <>
            {canCheck && (
              <Button variant="outline" onClick={() => act("check", () => backend.checkNow(m.id))} disabled={!!busy}>
                {busy === "check" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
              </Button>
            )}
            {canPause && (
              <Button variant="outline" onClick={() => act("pause", () => backend.pauseMission(m.id), "Monitoring paused")} disabled={!!busy}>
                <Pause /> Pause
              </Button>
            )}
            {m.monitoringStatus === "paused" && (
              <Button variant="outline" onClick={() => act("resume", () => backend.resumeMission(m.id), "Monitoring resumed")} disabled={!!busy}>
                <Play /> Resume
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={() => navigate(`/app/missions/${m.id}/edit`)}>
                <Pencil /> Edit
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmCancel(true)}>
                <Ban /> Cancel
              </Button>
            )}
          </>
        }
      />

      {booking && (
        <Alert variant="signal" className="mb-6">
          <BadgeCheck />
          <AlertTitle>{m.mode === "demo" ? "Demo booking confirmed (simulated)" : "Booking confirmed by the provider"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Booking reference <span className="font-mono font-semibold text-foreground">{booking.airlineBookingReference}</span> · {money(booking.totalPaid, booking.currency, { decimals: true })} · ticket {booking.ticketingStatus}
            </span>
            <Button asChild size="sm">
              <Link to={`/app/bookings/${booking.id}`}>
                <Ticket /> View confirmation
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {needsApproval && (
        <Alert variant="signal" className="mb-6">
          <ShoppingCart />
          <AlertTitle>Your target price is available</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>Automatic purchase is off. Approve to book the best eligible fare at or below {money(m.targetPrice, m.currency)} — the price is revalidated first.</span>
            <Button size="sm" variant="signal" onClick={() => setConfirmApprove(true)} disabled={!!busy}>
              Approve purchase
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {needsActivation && (
        <Alert variant="warn" className="mb-6">
          <ShieldAlert />
          <AlertTitle>{m.monitoringStatus === "draft" ? "This mission is a draft" : "Your authorization is needed"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{m.statusReason ?? (authCheck.valid ? "Review and authorize to start monitoring." : authCheck.reason)}</span>
            <Button size="sm" onClick={() => navigate(`/app/missions/${m.id}/edit?review=1`)}>
              <ShieldCheck /> Review & authorize
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {m.statusReason && !needsActivation && !booking && (
        <Alert variant={m.monitoringStatus === "action_required" || m.monitoringStatus === "booking_failed" ? "destructive" : "default"} className="mb-6">
          <AlertTriangle />
          <AlertDescription>{m.statusReason}</AlertDescription>
        </Alert>
      )}
      {m.lastError && (
        <Alert variant="destructive" className="mb-6">
          <XCircle />
          <AlertTitle>Last operational error</AlertTitle>
          <AlertDescription>{m.lastError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Current best eligible" accent={diff !== null && diff <= 0} hint={m.bestOffer ? `as of ${relative(m.bestOffer.observedAt)}` : "No eligible fares yet"}>
          {money(best, m.currency, { decimals: true })}
        </Stat>
        <Stat label="Target price">{money(m.targetPrice, m.currency)}</Stat>
        <Stat label="Difference" accent={diff !== null && diff <= 0} hint={diff === null ? undefined : diff <= 0 ? "At or below target" : "Above target"}>
          {diff === null ? "—" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff), m.currency, { decimals: true })}`}
        </Stat>
        <Stat label="Lowest observed">{money(m.lowestObserved, m.currency, { decimals: true })}</Stat>
        <Stat label="Maximum authorized" hint={m.priceTolerance > 0 ? `+${money(m.priceTolerance, m.currency)} tolerance` : "Zero tolerance"}>
          {money(spendingCeiling(m), m.currency)}
        </Stat>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Observed prices</CardTitle>
                <CardDescription>Best eligible total at each successful check ({observations.length} checks).</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <PriceChart observations={observations} target={m.targetPrice} max={spendingCeiling(m)} currency={m.currency} />
            </CardContent>
          </Card>

          <Tabs defaultValue="itinerary">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="itinerary">Best itinerary</TabsTrigger>
              <TabsTrigger value="activity">Activity log</TabsTrigger>
              <TabsTrigger value="attempts">Booking attempts {attempts.length > 0 && <span className="text-xs text-muted-foreground">{attempts.length}</span>}</TabsTrigger>
              <TabsTrigger value="conditions">Conditions</TabsTrigger>
            </TabsList>

            <TabsContent value="itinerary">
              {m.bestOffer?.offer ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{carriers(m.bestOffer.carriers)}</Badge>
                    {m.bestOffer.stops.map((s, i) => <Badge key={i} variant="outline">{i === 0 ? "Out" : "Return"}: {stopsLabel(s)} · {duration(m.bestOffer!.durationMinutes[i])}</Badge>)}
                    <span className="ml-auto font-display text-lg font-semibold tabular">{money(m.bestOffer.totalAmount, m.currency, { decimals: true })}</span>
                  </div>
                  <Itinerary offer={m.bestOffer.offer} />
                  {m.mode === "demo" && <p className="text-xs text-demo">Simulated itinerary — flight numbers and schedules are illustrative.</p>}
                </div>
              ) : (
                <Card className="p-8 text-center text-sm text-muted-foreground">No eligible itinerary found yet. FareBuddy keeps checking on schedule.</Card>
              )}
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardContent className="p-0">
                  {audit.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No activity yet.</p>
                  ) : (
                    <ol className="divide-y">
                      {audit.map((e) => (
                        <li key={e.id} className="flex gap-3 px-5 py-3 text-sm">
                          <span className="w-28 shrink-0 text-xs text-muted-foreground tabular">{dateTime(e.createdAt)}</span>
                          <div className="min-w-0">
                            <Badge variant="secondary" className="mb-1 font-mono text-[10px]">{e.kind}</Badge>
                            <p className="break-words text-muted-foreground">{e.message}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attempts">
              <Card>
                <CardContent className="p-0">
                  {attempts.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No purchase attempts yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-5 py-3 font-medium">When</th>
                            <th className="px-3 py-3 font-medium">Status</th>
                            <th className="px-3 py-3 font-medium">Amount</th>
                            <th className="px-3 py-3 font-medium">Idempotency key</th>
                            <th className="px-5 py-3 font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {attempts.map((a) => (
                            <tr key={a.id}>
                              <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{dateTime(a.createdAt)}</td>
                              <td className="px-3 py-3">
                                <Badge variant={a.status === "confirmed" ? "signal" : a.status === "unknown" || a.status === "submitted" ? "warn" : a.status === "failed" ? "destructive" : "secondary"}>{a.status}</Badge>
                              </td>
                              <td className="px-3 py-3 tabular">{money(a.amount, a.currency, { decimals: true })}</td>
                              <td className="max-w-[180px] truncate px-3 py-3 font-mono text-xs text-muted-foreground" title={a.idempotencyKey}>{a.idempotencyKey}</td>
                              <td className="px-5 py-3 text-muted-foreground">{a.failureReason ?? a.providerReference ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="conditions">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Booking conditions</CardTitle>
                  <CardDescription>{auth ? `Authorized ${dateTime(auth.authorizedAt)} (v${auth.version})` : "Not authorized yet"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(auth?.summary ?? []).map((l) => (
                      <li key={l} className="flex gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                        {l}
                      </li>
                    ))}
                  </ul>
                  {auth && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">Consent: “{auth.consentText}”</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          {m.mode === "demo" && <DemoControls mission={m} onRun={async () => act("check", () => backend.checkNow(m.id))} />}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" /> Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row label="Last successful check">{m.lastCheckedAt ? relative(m.lastCheckedAt) : "Never"}</Row>
              <Row label="Next scheduled check">{m.nextCheckAt ? relative(m.nextCheckAt) : "—"}</Row>
              <Row label="Frequency">{MONITORING_INTERVALS.find((i) => i.minutes === m.monitoringIntervalMinutes)?.label ?? `${m.monitoringIntervalMinutes} min`}</Row>
              <Row label="Checks performed">{m.checkCount}</Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {authCheck.valid ? <ShieldCheck className="h-4 w-4 text-signal" /> : <ShieldAlert className="h-4 w-4 text-warn" />} Payment authorization
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row label="Status">
                {authCheck.valid ? <Badge variant="signal">Valid</Badge> : <Badge variant="warn">{auth ? "Needs renewal" : "Not authorized"}</Badge>}
              </Row>
              <Row label="Automatic purchase">{auth?.autoPurchase && authCheck.valid ? <span className="inline-flex items-center gap-1 text-signal"><Zap className="h-3.5 w-3.5" /> On</span> : "Off — approval required"}</Row>
              <Row label="Maximum amount"><Money amount={auth?.maxAmount ?? m.maximumAuthorizedAmount} currency={m.currency} /></Row>
              <Row label="Payment method">{pm?.label ?? "None selected"}</Row>
              {!authCheck.valid && auth && <p className="pt-2 text-xs text-muted-foreground">{authCheck.reason}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileWarning className="h-4 w-4" /> Travelers & documents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {paxNames.length === 0 && <p className="text-sm text-muted-foreground">No travelers selected.</p>}
              {docs.map((d) => (
                <div key={d.passengerId} className="text-sm">
                  <div className="font-medium">{d.name}</div>
                  <ul className="mt-1 space-y-1">
                    {d.checks.map((c) => (
                      <li key={c.message} className="flex gap-1.5 text-xs">
                        {c.level === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-signal" /> : c.level === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />}
                        <span className="text-muted-foreground">
                          {c.level === "unverified" && <strong className="font-medium text-warn">Not verified: </strong>}
                          {c.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this mission?</DialogTitle>
            <DialogDescription>Monitoring stops, the purchase authorization is revoked and any reserved wallet funds are released. This can’t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep mission</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setConfirmCancel(false);
                await act("cancel", () => backend.cancelMission(m.id), "Mission cancelled");
              }}
            >
              Cancel mission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this purchase?</DialogTitle>
            <DialogDescription>
              FareBuddy will revalidate the best eligible fare (currently {money(best, m.currency, { decimals: true })}) and book it only if the final total is within {money(spendingCeiling(m), m.currency)}, using {pm?.label ?? "your payment method"}.
              {m.mode === "demo" && " This is a demo: the booking and payment are simulated."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApprove(false)}>Not now</Button>
            <Button
              variant="signal"
              onClick={async () => {
                setConfirmApprove(false);
                await act("approve", () => backend.approvePurchase(m.id));
              }}
            >
              Approve & book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
