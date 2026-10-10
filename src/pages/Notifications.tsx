import type { AppNotification } from "@engine/types.ts";
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBackend, useData, useTicker } from "@/hooks/backend";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<AppNotification["severity"], typeof Info> = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: XCircle };
const COLOR: Record<AppNotification["severity"], string> = {
  info: "bg-secondary text-muted-foreground",
  success: "bg-signal-soft text-signal",
  warning: "bg-warn-soft text-warn",
  critical: "bg-destructive/10 text-destructive",
};

export default function Notifications() {
  useTicker();
  const { backend } = useBackend();
  const { data: list } = useData((b) => b.listNotifications(), []);
  const unread = (list ?? []).filter((n) => !n.readAt).length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Price alerts, purchase attempts, confirmations and anything that needs you."
        actions={
          unread > 0 ? (
            <Button variant="outline" onClick={() => backend.markAllNotificationsRead()}>
              <CheckCheck /> Mark all read
            </Button>
          ) : undefined
        }
      />
      {list && list.length === 0 && <EmptyState icon={<Bell className="h-5 w-5" />} title="You’re all caught up" description="FareBuddy will notify you here when something happens." />}
      <Card className="divide-y overflow-hidden">
        {(list ?? []).map((n) => {
          const Icon = ICON[n.severity];
          const body = (
            <div className={cn("flex gap-3 p-4 transition-colors hover:bg-accent/50", !n.readAt && "bg-signal-soft/20")}>
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", COLOR[n.severity])}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.title}</span>
                  {n.requiresAction && !n.readAt && <Badge variant="warn">Action required</Badge>}
                  {!n.readAt && <span className="h-2 w-2 rounded-full bg-signal" />}
                  <span className="ml-auto text-xs text-muted-foreground">{relative(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
              </div>
            </div>
          );
          return n.missionId ? (
            <Link key={n.id} to={`/app/missions/${n.missionId}`} onClick={() => backend.markNotificationRead(n.id)} className="block">
              {body}
            </Link>
          ) : (
            <button key={n.id} type="button" onClick={() => backend.markNotificationRead(n.id)} className="block w-full text-left">
              {body}
            </button>
          );
        })}
      </Card>
    </div>
  );
}
