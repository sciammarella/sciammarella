import { ArrowRight, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import { ModeBadge } from "@/components/ModeBadge";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useData } from "@/hooks/backend";
import { dateLabel, money } from "@/lib/format";

export default function Bookings() {
  const { data: bookings } = useData((b) => b.listBookings(), []);
  return (
    <div>
      <PageHeader title="Bookings" description="Itineraries confirmed by the booking provider." />
      {bookings && bookings.length === 0 && (
        <EmptyState icon={<Ticket className="h-5 w-5" />} title="No bookings yet" description="When a mission books a flight, the confirmed itinerary appears here." />
      )}
      <div className="space-y-3">
        {(bookings ?? []).map((b) => {
          const out = b.itineraryDetails.slices[0];
          const ret = b.itineraryDetails.slices[1];
          return (
            <Link key={b.id} to={`/app/bookings/${b.id}`} className="group block">
              <Card className="flex flex-col gap-3 p-4 transition-shadow group-hover:shadow-md sm:flex-row sm:items-center sm:p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Ticket className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-semibold">
                      {out.origin} {ret ? "⇄" : "→"} {out.destination}
                    </span>
                    <ModeBadge mode={b.mode} />
                    <Badge variant={b.ticketingStatus === "issued" ? "signal" : "warn"}>{b.ticketingStatus === "issued" ? "Ticket issued" : "Ticketing pending"}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {dateLabel(out.departureAt.slice(0, 10))}
                    {ret ? ` – ${dateLabel(ret.departureAt.slice(0, 10))}` : ""} · {b.passengerNames.join(", ")}
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:text-right">
                  <div>
                    <div className="font-mono text-sm font-semibold">{b.airlineBookingReference}</div>
                    <div className="text-sm tabular text-muted-foreground">{money(b.totalPaid, b.currency, { decimals: true })}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
