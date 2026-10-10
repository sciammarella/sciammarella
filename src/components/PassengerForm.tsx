import type { PassengerInput } from "@engine/service.ts";
import { Loader2, Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useBackend } from "@/hooks/backend";
import { showError } from "@/lib/errors";

export const COUNTRIES: [string, string][] = [
  ["BR", "Brazil"], ["US", "United States"], ["PT", "Portugal"], ["AR", "Argentina"], ["CL", "Chile"], ["CO", "Colombia"], ["MX", "Mexico"],
  ["CA", "Canada"], ["GB", "United Kingdom"], ["FR", "France"], ["DE", "Germany"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["CH", "Switzerland"], ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["IN", "India"], ["AU", "Australia"], ["ZA", "South Africa"],
  ["AE", "United Arab Emirates"], ["SG", "Singapore"],
];

export function emptyPassenger(): PassengerInput {
  return {
    passengerType: "adult",
    fullLegalName: "",
    givenName: "",
    familyName: "",
    dateOfBirth: "",
    gender: null,
    nationality: "BR",
    passportNumber: "",
    passportIssuingCountry: "BR",
    passportExpiry: "",
    email: "",
    phone: "",
    frequentFlyer: null,
  };
}

export function PassengerForm({ initial, onSaved, onCancel }: { initial?: PassengerInput; onSaved: (id: string) => void; onCancel?: () => void }) {
  const { backend } = useBackend();
  const [p, setP] = useState<PassengerInput>(initial ?? emptyPassenger());
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PassengerInput>(k: K, v: PassengerInput[K]) => setP((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await backend.savePassenger(p);
      onSaved(saved.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="given">Given name(s)</Label>
          <Input id="given" required value={p.givenName} onChange={(e) => set("givenName", e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="family">Family name(s)</Label>
          <Input id="family" required value={p.familyName} onChange={(e) => set("familyName", e.target.value)} autoComplete="off" />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">Exactly as printed on the passport — this forms the full legal name sent to the airline.</p>
        <div className="space-y-1.5">
          <Label htmlFor="type">Passenger type</Label>
          <Select id="type" value={p.passengerType} onChange={(e) => set("passengerType", e.target.value as PassengerInput["passengerType"])}>
            <option value="adult">Adult (12+)</option>
            <option value="child">Child (2–11)</option>
            <option value="infant">Infant (under 2)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <Input id="dob" type="date" required value={p.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender <span className="font-normal text-muted-foreground">(only if the airline requires it)</span></Label>
          <Select id="gender" value={p.gender ?? ""} onChange={(e) => set("gender", (e.target.value || null) as PassengerInput["gender"])}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unspecified">Unspecified (X)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nat">Nationality</Label>
          <Select id="nat" value={p.nationality} onChange={(e) => set("nationality", e.target.value)}>
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4 text-signal" /> Passport (required for international trips)
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ppn">Passport number</Label>
            <Input id="ppn" value={p.passportNumber} onChange={(e) => set("passportNumber", e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ppc">Issuing country</Label>
            <Select id="ppc" value={p.passportIssuingCountry} onChange={(e) => set("passportIssuingCountry", e.target.value)}>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ppe">Expiration date</Label>
            <Input id="ppe" type="date" value={p.passportExpiry} onChange={(e) => set("passportExpiry", e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {backend.kind === "supabase"
            ? "Encrypted server-side (AES-256-GCM) before storage. Never shown in lists, logs or analytics."
            : "Browser demo: encrypted (AES-256-GCM) with a key stored in this browser. Demo-grade storage only — do not enter real passport data."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={p.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone (international format)</Label>
          <Input id="phone" type="tel" required placeholder="+55 27 99999-0000" value={p.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ffa">Frequent flyer airline <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input
            id="ffa"
            placeholder="e.g. LA"
            maxLength={2}
            value={p.frequentFlyer?.airline ?? ""}
            onChange={(e) => set("frequentFlyer", e.target.value || p.frequentFlyer?.number ? { airline: e.target.value.toUpperCase(), number: p.frequentFlyer?.number ?? "" } : null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ffn">Frequent flyer number</Label>
          <Input
            id="ffn"
            value={p.frequentFlyer?.number ?? ""}
            onChange={(e) => set("frequentFlyer", e.target.value || p.frequentFlyer?.airline ? { airline: p.frequentFlyer?.airline ?? "", number: e.target.value } : null)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save passenger
        </Button>
      </div>
    </form>
  );
}
