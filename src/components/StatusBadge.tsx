import type { MissionStatus } from "@engine/types.ts";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, Loader2, PauseCircle, Radar, Target, XCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const META: Record<MissionStatus, { label: string; variant: BadgeProps["variant"]; icon: typeof Radar }> = {
  draft: { label: "Draft", variant: "secondary", icon: CircleDashed },
  monitoring: { label: "Monitoring", variant: "signal", icon: Radar },
  target_reached: { label: "Target Price Reached", variant: "signal", icon: Target },
  booking_in_progress: { label: "Booking in Progress", variant: "warn", icon: Loader2 },
  booked: { label: "Booked", variant: "default", icon: CheckCircle2 },
  action_required: { label: "Action Required", variant: "warn", icon: AlertTriangle },
  paused: { label: "Paused", variant: "secondary", icon: PauseCircle },
  expired: { label: "Expired", variant: "secondary", icon: Clock },
  booking_failed: { label: "Booking Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "secondary", icon: Ban },
};

export function statusLabel(s: MissionStatus) {
  return META[s].label;
}

export function StatusBadge({ status, className }: { status: MissionStatus; className?: string }) {
  const m = META[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className={cn("gap-1.5", className)}>
      {status === "monitoring" ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
        </span>
      ) : (
        <Icon className={cn("h-3.5 w-3.5", status === "booking_in_progress" && "animate-spin")} />
      )}
      {m.label}
    </Badge>
  );
}
