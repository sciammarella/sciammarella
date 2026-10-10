import { airlineName } from "@engine/airlines.ts";
import { ArrowLeft, BadgeCheck, CircleDashed, Download, FlaskConical, Mail, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Itinerary } from "@/components/Itinerary";
import { ModeBadge } from "@/components/ModeBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useData } from "@/hooks/backend";
import { dateTime, money } from "@/lib/format";
import { downloadItinerary } from "@/lib/itineraryFile";
import { cn } from "@/lib/utils";

function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-medium", mono && "font-mono")}>{children}</div>
    </div>
  );
}

export default function BookingDetail() {
  const { id = "" } = useParams();
  const { data: booking, loading } = useData((b) => b.getBooking(id), [id]);
  if (loading && !booking) return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!booking) return <div className="py-20 text-center text-sm text-muted-foreground">Booking not found.</div>;

  const demo = booking.mode === "demo";
  const flights = booking.itineraryDetails.slices.flatMap((s) => s.segments);
  const issued = booking.ticketingStatus === "issued";

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={`/app/missions/${booking.missionId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to mission
      </Link>

      {demo && (
        <Alert variant="demo" className="mb-5">
          <FlaskConical />
          <AlertTitle>Demonstration booking — not a real reservation</AlertTitle>
          <AlertDescription>
            This confirmation was produced by FareBuddy’s simulated booking provider. No airline seat was reserved, no ticket was issued and no money was charged. It cannot be used for travel.
          </AlertDescription>
        </Alert>
      )}

      <Card className={cn("relative overflow-hidden", demo && "border-demo/40")}>
        {demo && (
          <div className="pointer-events-none absolute right-[-48px] top-6 rotate-45 bg-demo px-14 py-1 text-xs font-bold uppercase tracking-widest text-white">Demo</div>
        )}
        <div className="bg-primary px-6 py-6 text-primary-foreground sm:px-8">
          <div className="flex items-center gap-2 text-sm text-primary-foreground/70">
            <BadgeCheck className="h-4 w-4 text-signal" /> {demo ? "Simulated provider confirmation" : "Confirmed by the booking provider"}
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-primary-foreground/60">Booking reference (PNR)</div>
              <div className="font-mono text-3xl font-semibold tracking-widest sm:text-4xl">{booking.airlineBookingReference}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-primary-foreground/60">Total paid</div>
              <div className="font-display text-3xl font-semibold tabular">{money(booking.totalPaid, booking.currency, { decimals: true })}</div>
            </div>
          </div>
        </div>
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={cn("flex items-start gap-3 rounded-xl border p-4", "border-signal/40 bg-signal-soft/50")}>
              <BadgeCheck className="mt-0.5 h-5 w-5 text-signal" />
              <div>
                <div className="font-medium">Reservation confirmed</div>
                <div className="text-sm text-muted-foreground">{dateTime(booking.providerConfirmation.confirmedAt)}</div>
              </div>
            </div>
            <div className={cn("flex items-start gap-3 rounded-xl border p-4", issued ? "border-signal/40 bg-signal-soft/50" : "border-warn/40 bg-warn-soft/50")}>
              {issued ? <Ticket className="mt-0.5 h-5 w-5 text-signal" /> : <CircleDashed className="mt-0.5 h-5 w-5 text-warn" />}
              <div>
                <div className="font-medium">{issued ? "Ticket issued" : "Ticket issuance pending"}</div>
                <div className="text-sm text-muted-foreground">
                  {issued ? booking.ticketNumbers.join(", ") || "E-ticket numbers not provided" : "The provider confirmed the reservation; ticket numbers will follow."}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <KV label="Airlines">{[...new Set(flights.map((f) => airlineName(f.marketingCarrier)))].join(", ")}</KV>
            <KV label="Flight numbers" mono>{flights.map((f) => f.flightNumber).join(" · ")}</KV>
            <KV label="Passengers">{booking.passengerNames.join(", ")}</KV>
            <KV label="Payment method">{booking.paymentSummary.label}</KV>
            <KV label="Provider" mono>{booking.provider}</KV>
            <KV label="Provider reference" mono>{booking.providerBookingReference}</KV>
          </div>

          <Separator />

          <div>
            <h2 className="mb-3 text-lg font-semibold">Itinerary</h2>
            <Itinerary offer={booking.itineraryDetails} />
          </div>

          <Separator />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 text-sm text-muted-foreground">
              <Mail className="mr-1.5 inline h-4 w-4" /> An in-app notification was sent{demo ? "" : " and an email when email delivery is configured"}.
              <div className="mt-1 text-xs">Provider message: “{booking.providerConfirmation.message}”</div>
            </div>
            <div className="flex gap-2">
              {booking.documents.map((d) => (
                <Button key={d.url} asChild variant="outline">
                  <a href={d.url} target="_blank" rel="noreferrer">
                    <Download /> {d.label}
                  </a>
                </Button>
              ))}
              <Button onClick={() => downloadItinerary(booking)}>
                <Download /> {demo ? "Download demo itinerary" : "Download itinerary"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ModeBadge mode={booking.mode} /> Booking id <span className="font-mono">{booking.id}</span>
        <Badge variant="outline" className="ml-auto">{booking.bookingStatus}</Badge>
      </div>
    </div>
  );
}
