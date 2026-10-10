import type { PassengerInput } from "@engine/service.ts";
import { Lock, Pencil, Plus, Trash2, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { PassengerForm } from "@/components/PassengerForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBackend, useData } from "@/hooks/backend";
import { showError } from "@/lib/errors";
import { dateLabel } from "@/lib/format";

export default function Passengers() {
  const { backend } = useBackend();
  const { data: passengers } = useData((b) => b.listPassengers(), []);
  const [editing, setEditing] = useState<{ open: boolean; initial?: PassengerInput }>({ open: false });
  const soon = new Date(Date.now() + 183 * 86400000).toISOString().slice(0, 10);

  const edit = async (id: string) => {
    try {
      setEditing({ open: true, initial: await backend.getPassenger(id) });
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div>
      <PageHeader
        title="Passengers"
        description="Saved traveler profiles. Sensitive fields are encrypted and only shared with the booking provider."
        actions={
          <Button onClick={() => setEditing({ open: true })}>
            <Plus /> Add traveler
          </Button>
        }
      />
      {passengers && passengers.length === 0 && (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No travelers yet"
          description="Save traveler details once and reuse them for every mission."
          action={<Button onClick={() => setEditing({ open: true })}><Plus /> Add traveler</Button>}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(passengers ?? []).map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <UserRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.displayName}</div>
                <div className="text-xs capitalize text-muted-foreground">{p.passengerType} · {p.nationality}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <Lock className="h-3.5 w-3.5 text-signal" />
              {p.passportLast4 ? (
                <>
                  Passport ••••{p.passportLast4}
                  <span className="ml-auto">
                    {p.passportExpiry && p.passportExpiry < soon ? <Badge variant="warn">Expires {dateLabel(p.passportExpiry)}</Badge> : <span className="text-muted-foreground">exp. {dateLabel(p.passportExpiry)}</span>}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">No passport on file (domestic trips only)</span>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => edit(p.id)}>
                <Pencil /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  if (!confirm(`Delete ${p.displayName}? Their encrypted data will be removed.`)) return;
                  try {
                    await backend.deletePassenger(p.id);
                    toast.success("Traveler deleted");
                  } catch (e) {
                    showError(e);
                  }
                }}
              >
                <Trash2 /> Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={editing.open} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing.initial ? "Edit traveler" : "Add a traveler"}</DialogTitle>
            <DialogDescription>Only information required for booking is collected. Gender is asked only when an airline requires it.</DialogDescription>
          </DialogHeader>
          <PassengerForm
            key={editing.initial?.id ?? "new"}
            initial={editing.initial}
            onCancel={() => setEditing({ open: false })}
            onSaved={() => {
              setEditing({ open: false });
              toast.success("Traveler saved");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
