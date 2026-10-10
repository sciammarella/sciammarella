import { CheckCircle2, CircleDashed, FlaskConical, Gauge, Server, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DEMO_SPEED_KEY } from "@/backend/local";
import { ModeBadge } from "@/components/ModeBadge";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useBackend } from "@/hooks/backend";

export default function SettingsPage() {
  const { status, session, backend } = useBackend();
  const [speed, setSpeed] = useState(() => localStorage.getItem(DEMO_SPEED_KEY) ?? "60");
  if (!status) return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Account, runtime mode and integration status." />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="font-medium">{session?.fullName || "—"}</div>
          <div className="text-muted-foreground">{session?.email}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="text-sm">Runtime mode</CardTitle>
            <CardDescription>Live mode activates only when every required integration is configured and verified.</CardDescription>
          </div>
          <ModeBadge mode={status.mode} />
        </CardHeader>
        <CardContent className="space-y-4">
          {status.mode === "demo" ? (
            <Alert variant="demo">
              <FlaskConical />
              <AlertTitle>Demo mode</AlertTitle>
              <AlertDescription>
                Flight offers, price changes, card holds, wallet deposits and bookings are simulated. Confirmations are clearly labeled and are never real reservations. Missions created in demo mode always stay demo missions.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="signal">
              <ShieldCheck />
              <AlertTitle>Live mode</AlertTitle>
              <AlertDescription>Real offers, real payments and real bookings. Only missions you explicitly authorize can spend money.</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border p-3">
              <Server className="h-4 w-4 text-muted-foreground" />
              Backend: <strong>{status.backend === "supabase" ? "Supabase" : "Browser only (demo)"}</strong>
            </div>
            <div className="flex items-center gap-2 rounded-xl border p-3">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              Scheduler: <strong>{status.scheduler === "server" ? "Server-side (pg_cron)" : "Runs while a tab is open"}</strong>
            </div>
          </div>
          {backend.kind === "browser" && (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="speed">Demo time acceleration</Label>
              <Select
                id="speed"
                value={speed}
                onChange={(e) => {
                  setSpeed(e.target.value);
                  localStorage.setItem(DEMO_SPEED_KEY, e.target.value);
                  toast.success("Applies from the next scheduled check");
                }}
              >
                <option value="1">Real time</option>
                <option value="12">12× (1 hour = 5 min)</option>
                <option value="60">60× (1 hour = 1 min)</option>
                <option value="240">240× (1 hour = 15 s)</option>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Integration status</CardTitle>
          <CardDescription>What still requires external credentials or provider approval before live use.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {status.checks.map((c) => (
            <div key={c.key} className="flex items-start gap-3 rounded-xl border p-3">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> : c.required ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {c.label}
                  <Badge variant={c.required ? "outline" : "secondary"} className="text-[10px]">{c.required ? "Required for live" : "Optional"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Passenger data encryption: <strong>{status.passengerEncryption === "server" ? "server-side AES-256-GCM" : status.passengerEncryption === "browser-demo" ? "browser demo key (not for real data)" : "NOT CONFIGURED"}</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
