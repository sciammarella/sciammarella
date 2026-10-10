import { airlineName } from "@engine/airlines.ts";
import { getAirport } from "@engine/airports.ts";
import type { FlightOffer, Slice } from "@engine/types.ts";
import { Luggage, Plane } from "lucide-react";
import { dayOffset, duration, localDate, localTime, stopsLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

function SliceView({ slice, label }: { slice: Slice; label: string }) {
  const stops = slice.segments.length - 1;
  const plus = dayOffset(slice.departureAt, slice.arrivalAt);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{label} · {localDate(slice.departureAt)}</span>
        <span>{duration(slice.durationMinutes)} · {stopsLabel(stops)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-left">
          <div className="font-display text-xl font-semibold tabular">{localTime(slice.departureAt)}</div>
          <div className="font-mono text-xs text-muted-foreground">{slice.origin}</div>
        </div>
        <div className="relative flex-1">
          <div className="h-px w-full bg-border" />
          <div className="absolute inset-x-0 -top-1.5 flex justify-around">
            {slice.segments.slice(1).map((s) => (
              <span key={s.origin + s.departureAt} className="h-3 w-3 rounded-full border-2 border-card bg-muted-foreground/60" title={s.origin} />
            ))}
          </div>
          <Plane className="absolute -top-2 right-0 h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-semibold tabular">
            {localTime(slice.arrivalAt)}
            {plus > 0 && <sup className="ml-0.5 text-xs font-medium text-warn">+{plus}</sup>}
          </div>
          <div className="font-mono text-xs text-muted-foreground">{slice.destination}</div>
        </div>
      </div>
      <ol className="mt-4 space-y-2 border-t pt-3">
        {slice.segments.map((seg, i) => {
          const next = slice.segments[i + 1];
          const layover = next ? Math.round((Date.parse(`${next.departureAt}Z`) - Date.parse(`${seg.arrivalAt}Z`)) / 60000) : 0;
          return (
            <li key={seg.flightNumber + seg.departureAt} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  {seg.origin} → {seg.destination}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{seg.flightNumber}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular">
                  {localTime(seg.departureAt)} – {localTime(seg.arrivalAt)} · {duration(seg.durationMinutes)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {airlineName(seg.marketingCarrier)} · {seg.aircraft} · {seg.cabin.replace("_", " ")}
              </div>
              {next && (
                <div className="mt-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                  {duration(layover)} connection in {getAirport(seg.destination)?.city ?? seg.destination}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Itinerary({ offer, className }: { offer: FlightOffer; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {offer.slices.map((s, i) => (
        <SliceView key={i} slice={s} label={offer.slices.length > 1 ? (i === 0 ? "Outbound" : "Return") : "Flight"} />
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{offer.fareBrand}</span>
        <span className="inline-flex items-center gap-1">
          <Luggage className="h-3.5 w-3.5" /> {offer.includedCheckedBagsPerPassenger} checked bag(s) included per passenger
        </span>
        <span>{offer.refundable ? "Refundable" : "Non-refundable"}</span>
      </div>
    </div>
  );
}
