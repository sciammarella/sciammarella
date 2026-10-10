import type { PriceObservation } from "@engine/types.ts";
import { AlertTriangle, ArrowRight, Bell, CalendarDays, CreditCard, Plane, Plus, Radar, ScrollText, Ticket, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { MissionCard } from "@/components/MissionCard";
import { ModeBadge } from "@/components/ModeBadge";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackend, useData, useTicker } from "@/hooks/backend";
import { dateLabel, money, relative } from "@/lib/format";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  useTicker();
  const { session } = useBackend();
  const { data, loading } = useData(async (b) => {
    const [missions, bookings, notifications, payments, audit] = await Promise.all([b.listMissions(), b.listBookings(), b.listNotifications(), b.listPaymentMethods(), b.listAudit(null, 12)]);
    const active = missions.filter((m) => ["monitoring", "target_reached", "booking_in_progress", "action_required", "paused", "draft", "booking_failed"].includes(m.monitoringStatus));
    const obs: Record<string, PriceObservation[]> = {};
    await Promise.all(active.slice(0, 12).map(async (m) => (obs[m.id] = await b.listObservations(m.id))));
    const allObs: Record<string, PriceObservation[]> = { ...obs };
    await Promise.all(bookings.filter((bk) => !allObs[bk.missionId]).map(async (bk) => (allObs[bk.missionId] = await b.listObservations(bk.missionId))));
    return { missions, active, bookings, notifications, payments, audit, obs: allObs };
  });

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data) return null;

  const { active, bookings, notifications, payments, audit, obs, missions } = data;
  const watching = missions.filter((m) => ["monitoring", "target_reached", "booking_in_progress"].includes(m.monitoringStatus));
  const attention = notifications.filter((n) => n.requiresAction && !n.readAt);
  const needsAction = missions.filter((m) => m.monitoringStatus === "action_required" || m.monitoringStatus === "target_reached");
  // Savings vs market: average eligible price observed for that mission minus what was paid.
  const savings = bookings.reduce((sum, b) => {
    const prices = (obs[b.missionId] ?? []).filter((o) => o.eligible).map((o) => o.totalPrice);
    if (!prices.length) return sum;
    const avg = prices.reduce((a, c) => a + c, 0) / prices.length;
    return sum + Math.max(0, avg - b.totalPaid);
  }, 0);
  const watchingGap = watching.filter((m) => m.bestOffer).reduce((s, m) => s + Math.max(0, m.bestOffer!.totalAmount - m.targetPrice), 0);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings
    .filter((b) => b.itineraryDetails.slices[0].departureAt.slice(0, 10) >= today)
    .sort((a, b) => a.itineraryDetails.slices[0].departureAt.localeCompare(b.itineraryDetails.slices[0].departureAt));

  const stats = [
    { label: "Active missions", value: String(watching.length), icon: Radar, hint: `${active.length} total open` },
    { label: "Needs your attention", value: String(needsAction.length), icon: AlertTriangle, hint: needsAction.length ? "Review below" : "All clear" },
    { label: "Gap to targets", value: money(watchingGap, "USD"), icon: Plane, hint: "Across monitored missions" },
    { label: "Saved vs. market", value: money(savings, "USD"), icon: Ticket, hint: `${bookings.length} booking${bookings.length === 1 ? "" : "s"}` },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting()}${session?.fullName ? `, ${session.fullName.split(" ")[0]}` : ""}`}
        description="Here’s what FareBuddy is doing for you."
        actions={
          <Button asChild variant="signal">
            <Link to="/app/missions/new">
              <Plus /> Create a Flight Mission
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {s.label}
              <s.icon className="h-4 w-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-semibold tabular">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.hint}</div>
          </Card>
        ))}
      </div>

      {attention.length > 0 && (
        <Card className="mt-6 border-warn/40 bg-warn-soft/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warn" /> Notifications requiring your attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.slice(0, 4).map((n) => (
              <Link key={n.id} to={n.missionId ? `/app/missions/${n.missionId}` : "/app/notifications"} className="flex items-start gap-3 rounded-lg bg-card p-3 text-sm hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.title}</div>
                  <div className="line-clamp-2 text-muted-foreground">{n.body}</div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Flight missions</h2>
            <Link to="/app/missions" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>
          </div>
          {active.length === 0 ? (
            <EmptyState
              icon={<Plane className="h-5 w-5" />}
              title="No active missions"
              description="Tell FareBuddy where you want to go and what you want to pay. It will watch prices and book when they hit your target."
              action={
                <Button asChild variant="signal">
                  <Link to="/app/missions/new">
                    <Plus /> Create a Flight Mission
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {active.map((m) => (
                <MissionCard key={m.id} mission={m} observations={obs[m.id]} />
              ))}
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4" /> Upcoming trips
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.length === 0 && <p className="text-sm text-muted-foreground">No booked trips yet.</p>}
              {upcoming.slice(0, 3).map((b) => (
                <Link key={b.id} to={`/app/bookings/${b.id}`} className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent">
                  <div>
                    <div className="font-medium">
                      {b.itineraryDetails.slices[0].origin} → {b.itineraryDetails.slices[0].destination}
                    </div>
                    <div className="text-xs text-muted-foreground">{dateLabel(b.itineraryDetails.slices[0].departureAt.slice(0, 10))}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs">{b.airlineBookingReference}</div>
                    <ModeBadge mode={b.mode} className="mt-1" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4" /> Payment methods
              </CardTitle>
              <Link to="/app/payments" className="text-xs text-muted-foreground hover:text-foreground">Manage</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {payments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No payment method yet. <Link to="/app/payments" className="font-medium text-foreground underline">Add one</Link>
                </p>
              )}
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                  {p.paymentType === "card" ? <CreditCard className="h-4 w-4 text-muted-foreground" /> : <Wallet className="h-4 w-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {p.paymentType === "stablecoin_wallet" && <span className="font-medium tabular">{money(p.confirmedBalance ?? 0, "USD", { decimals: true })}</span>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ScrollText className="h-4 w-4" /> Recent activity
              </CardTitle>
              <Link to="/app/notifications" className="text-xs text-muted-foreground hover:text-foreground">
                <Bell className="h-4 w-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {audit.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
              <ol className="space-y-3">
                {audit.slice(0, 8).map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px]">{e.kind}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">{relative(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 break-all text-muted-foreground">{e.message}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
