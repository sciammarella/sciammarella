import type { FlightMission, PriceObservation } from "@engine/types.ts";
import { ArrowRight, Clock, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { ModeBadge } from "@/components/ModeBadge";
import { Sparkline } from "@/components/PriceChart";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { money, relative, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function paxCount(m: FlightMission) {
  const p = m.preferences.passengers;
  return p.adults + p.children + p.infants;
}

export function MissionCard({ mission, observations = [] }: { mission: FlightMission; observations?: PriceObservation[] }) {
  const best = mission.bestOffer?.totalAmount ?? null;
  const gap = best !== null ? best - mission.targetPrice : null;
  const reached = gap !== null && gap <= 0;
  const values = observations.filter((o) => o.eligible).map((o) => o.totalPrice).slice(-30);
  const active = ["monitoring", "target_reached", "booking_in_progress"].includes(mission.monitoringStatus);
  return (
    <Link to={`/app/missions/${mission.id}`} className="group block">
      <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-display text-lg font-semibold">{mission.title}</h3>
              {mission.mode === "live" && <ModeBadge mode="live" />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              <span>
                {shortDate(mission.departureDate)}
                {mission.returnDate ? ` – ${shortDate(mission.returnDate)}` : " · one way"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {paxCount(mission)}
              </span>
            </div>
          </div>
          <StatusBadge status={mission.monitoringStatus} />
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Best eligible now</div>
            <div className={cn("font-display text-2xl font-semibold tabular", reached && "text-signal")}>{money(best, mission.currency)}</div>
            <div className="text-xs text-muted-foreground">
              Target <span className="font-medium text-foreground tabular">{money(mission.targetPrice, mission.currency)}</span>
              {gap !== null && (
                <span className={cn("ml-2 font-medium tabular", reached ? "text-signal" : "text-muted-foreground")}>
                  {reached ? `${money(-gap, mission.currency)} under` : `${money(gap, mission.currency)} to go`}
                </span>
              )}
            </div>
          </div>
          <Sparkline values={values} className={cn("h-12 w-28 shrink-0", reached ? "text-signal" : "text-foreground/70")} />
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {active && mission.nextCheckAt ? `Next check ${relative(mission.nextCheckAt)}` : mission.lastCheckedAt ? `Last check ${relative(mission.lastCheckedAt)}` : "Not checked yet"}
          </span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </Link>
  );
}
