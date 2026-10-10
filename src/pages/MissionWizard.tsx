import { AIRLINES } from "@engine/airlines.ts";
import { getAirport } from "@engine/airports.ts";
import { authorizationSummary, consentText, materialChanges } from "@engine/authorization.ts";
import { DemoFlightProvider } from "@engine/demoFlightProvider.ts";
import { defaultPreferences, MONITORING_INTERVALS, missionTitle, placeRef, validateMissionDraft, withResolvedAirports } from "@engine/mission.ts";
import { buildSearchRequest, evaluateOffer, rankOffers } from "@engine/selection.ts";
import type { MissionInput } from "@engine/service.ts";
import type { CabinClass, Currency, FlightMission, RankingStrategy, TimeWindow } from "@engine/types.ts";
import { addDays } from "@engine/util.ts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  FlaskConical,
  Info,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PassengerForm } from "@/components/PassengerForm";
import { PlaceCombobox } from "@/components/PlaceCombobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BackendError } from "@/backend";
import { useBackend, useData } from "@/hooks/backend";
import { showError } from "@/lib/errors";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Route & dates", "Preferences", "Passengers", "Budget & payment", "Review & authorize"];

const CURRENCIES: Currency[] = ["USD", "EUR", "BRL", "GBP", "JPY"];

function emptyInput(): MissionInput {
  const prefs = defaultPreferences();
  return {
    originCode: "",
    destinationCode: "",
    departureDate: "",
    returnDate: "",
    passengerProfileIds: [],
    preferences: prefs,
    targetPrice: 0,
    maximumAuthorizedAmount: 0,
    priceTolerance: 0,
    currency: "USD",
    paymentMethodId: null,
    monitoringIntervalMinutes: 60,
  };
}

function fromMission(m: FlightMission): MissionInput {
  return {
    id: m.id,
    originCode: m.origin.code,
    destinationCode: m.destination.code,
    departureDate: m.departureDate,
    returnDate: m.returnDate ?? "",
    passengerProfileIds: m.passengerProfileIds,
    preferences: m.preferences,
    targetPrice: m.targetPrice,
    maximumAuthorizedAmount: m.maximumAuthorizedAmount,
    priceTolerance: m.priceTolerance,
    currency: m.currency,
    paymentMethodId: m.paymentMethodId,
    monitoringIntervalMinutes: m.monitoringIntervalMinutes,
  };
}

/** Build an in-memory mission for validation, summaries and demo price previews. */
function draftMission(input: MissionInput, base: FlightMission | null, userId: string, mode: "demo" | "live"): FlightMission {
  const origin = placeRef(input.originCode || "XXX");
  const destination = placeRef(input.destinationCode || "XXX");
  const preferences = withResolvedAirports({ origin, destination }, input.preferences);
  return {
    ...(base ?? {
      id: "draft",
      userId,
      mode,
      monitoringStatus: "draft",
      purchaseAuthorization: null,
      bestOffer: null,
      lowestObserved: null,
      lastCheckedAt: null,
      nextCheckAt: null,
      checkCount: 0,
      lastError: null,
      statusReason: null,
      notificationState: {},
      demoControls: null,
      createdAt: "",
      updatedAt: "",
    }),
    title: missionTitle({ origin, destination }),
    origin: input.originCode ? origin : { code: "", label: "" },
    destination: input.destinationCode ? destination : { code: "", label: "" },
    departureDate: input.departureDate,
    returnDate: preferences.tripType === "round_trip" ? input.returnDate || null : null,
    passengerProfileIds: input.passengerProfileIds,
    preferences,
    targetPrice: input.targetPrice,
    maximumAuthorizedAmount: input.maximumAuthorizedAmount,
    priceTolerance: input.priceTolerance,
    currency: input.currency,
    paymentMethodId: input.paymentMethodId,
    monitoringIntervalMinutes: input.monitoringIntervalMinutes,
  } as FlightMission;
}

const STEP_FIELDS: string[][] = [["origin", "destination", "departureDate", "returnDate"], [], ["passengers"], ["targetPrice", "maximumAuthorizedAmount", "priceTolerance"], []];

function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 9, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" size="icon" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus />
      </Button>
      <span className="w-6 text-center font-display text-lg font-semibold tabular">{value}</span>
      <Button type="button" variant="outline" size="icon" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus />
      </Button>
    </div>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border bg-card p-4">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

const WINDOWS: { value: TimeWindow; label: string; hint: string }[] = [
  { value: "any", label: "Any time", hint: "" },
  { value: "morning", label: "Morning", hint: "05–12h" },
  { value: "afternoon", label: "Afternoon", hint: "12–18h" },
  { value: "evening", label: "Evening", hint: "18–24h" },
];

function WindowPicker({ value, onChange, id }: { value: TimeWindow; onChange: (v: TimeWindow) => void; id: string }) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as TimeWindow)} className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-labelledby={id}>
      {WINDOWS.map((w) => (
        <RadioCard key={w.value} value={w.value} className="flex-col gap-0 py-2.5">
          <span className="font-medium">{w.label}</span>
          {w.hint && <span className="text-xs text-muted-foreground">{w.hint}</span>}
        </RadioCard>
      ))}
    </RadioGroup>
  );
}

export default function MissionWizard() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { backend, session, status } = useBackend();
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<MissionInput>(emptyInput);
  const [original, setOriginal] = useState<FlightMission | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [showErrors, setShowErrors] = useState(false);
  const [autoPurchase, setAutoPurchase] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"draft" | "activate" | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [paxDialog, setPaxDialog] = useState(false);
  const [preview, setPreview] = useState<{ cheapest: number | null; eligible: number; seen: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data: passengers } = useData((b) => b.listPassengers(), []);
  const { data: payments } = useData((b) => b.listPaymentMethods(), []);
  const mode = status?.mode ?? "demo";

  useEffect(() => {
    if (!id) return;
    backend.getMission(id).then((m) => {
      if (!m) {
        toast.error("Mission not found");
        navigate("/app/missions");
        return;
      }
      setOriginal(m);
      setInput(fromMission(m));
      setAutoPurchase(m.purchaseAuthorization?.autoPurchase ?? false);
      if (search.get("review")) setStep(4);
      setLoaded(true);
    });
  }, [id, backend, navigate, search]);

  const today = new Date().toISOString().slice(0, 10);
  const draft = useMemo(() => draftMission(input, original, session?.userId ?? "", original?.mode ?? mode), [input, original, session, mode]);
  const errors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of validateMissionDraft(draft, today)) if (!map[e.field]) map[e.field] = e.message;
    return map;
  }, [draft, today]);
  const stepErrors = (s: number) => STEP_FIELDS[s].filter((f) => errors[f]);
  const err = (f: string) => (showErrors ? errors[f] : undefined);

  const prefs = input.preferences;
  const setPrefs = (patch: Partial<MissionInput["preferences"]>) => setInput((x) => ({ ...x, preferences: { ...x.preferences, ...patch } }));
  const set = <K extends keyof MissionInput>(k: K, v: MissionInput[K]) => setInput((x) => ({ ...x, [k]: v }));
  const paxTotal = prefs.passengers.adults + prefs.passengers.children + prefs.passengers.infants;
  const selectedPm = payments?.find((p) => p.id === input.paymentMethodId) ?? null;
  const selectedNames = (passengers ?? []).filter((p) => input.passengerProfileIds.includes(p.id)).map((p) => p.displayName);
  const changes = useMemo(() => {
    if (!original?.purchaseAuthorization || original.purchaseAuthorization.revokedAt) return [];
    return materialChanges(original, { ...draft, maximumAuthorizedAmount: input.maximumAuthorizedAmount });
  }, [original, draft, input.maximumAuthorizedAmount]);

  const next = () => {
    const errs = stepErrors(step);
    if (errs.length) {
      setShowErrors(true);
      toast.error(errors[errs[0]]);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fillExample = () => {
    setInput((x) => ({
      ...x,
      originCode: "VIX",
      destinationCode: "TYO",
      departureDate: "2026-12-25",
      returnDate: "2027-01-12",
      targetPrice: x.targetPrice || 1000,
      maximumAuthorizedAmount: x.maximumAuthorizedAmount || 1000,
      preferences: { ...x.preferences, tripType: "round_trip", cabin: "economy", passengers: { adults: 1, children: 0, infants: 0 } },
    }));
  };

  const runPreview = () => {
    setPreviewing(true);
    setTimeout(async () => {
      try {
        const m = { ...draft, id: "preview", targetPrice: input.targetPrice || 1, maximumAuthorizedAmount: Math.max(input.maximumAuthorizedAmount, input.targetPrice, 1) };
        const offers = await new DemoFlightProvider().search({ ...buildSearchRequest(m), demo: { seed: "preview", tick: 0 } });
        const ranked = rankOffers(offers.map((o) => evaluateOffer(o, m)), m);
        setPreview({ cheapest: ranked[0]?.payableTotal ?? null, eligible: ranked.length, seen: offers.length });
      } finally {
        setPreviewing(false);
      }
    }, 30);
  };

  const save = async (activate: boolean) => {
    setIssues([]);
    for (let s = 0; s < 4; s++)
      if (stepErrors(s).length) {
        setShowErrors(true);
        setStep(s);
        toast.error(errors[stepErrors(s)[0]]);
        return;
      }
    setBusy(activate ? "activate" : "draft");
    try {
      const payload: MissionInput = { ...input, returnDate: prefs.tripType === "round_trip" ? input.returnDate || null : null };
      const { mission, materialChanges: applied } = await backend.saveMission(payload);
      setOriginal(mission);
      setInput(fromMission(mission));
      if (applied.length) toast.warning("Authorization revoked — the purchase conditions changed", { description: applied.join(", ") });
      if (!activate) {
        toast.success(id ? "Changes saved" : "Draft saved");
        navigate(`/app/missions/${mission.id}`);
        return;
      }
      const check = (await backend.activationCheck(mission.id)).filter((i) => i.level === "error").map((i) => i.message);
      if (check.length) {
        setIssues(check);
        toast.error("Mission saved, but it can't be activated yet");
        return;
      }
      await backend.activateMission(mission.id, autoPurchase);
      toast.success(autoPurchase ? "Monitoring activated — automatic purchase is on" : "Monitoring activated — you’ll approve each purchase");
      navigate(`/app/missions/${mission.id}`);
    } catch (e) {
      if (e instanceof BackendError && e.details.length) setIssues(e.details);
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return <div className="py-20 text-center text-sm text-muted-foreground">Loading mission…</div>;

  const originAirports = draft.preferences.originAirports;
  const destAirports = draft.preferences.destinationAirports;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={
          <Link to={id ? `/app/missions/${id}` : "/app/missions"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {id ? "Back to mission" : "Missions"}
          </Link>
        }
        title={id ? "Edit flight mission" : "Create a flight mission"}
        description="Define exactly what FareBuddy may buy on your behalf."
        actions={
          !id && step === 0 ? (
            <Button variant="outline" size="sm" onClick={fillExample}>
              <Sparkles /> Use example: Vitória → Tokyo
            </Button>
          ) : undefined
        }
      />

      {/* Step indicator */}
      <ol className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-[110px] flex-1">
            <button
              type="button"
              onClick={() => (i < step || stepErrors(step).length === 0 ? setStep(i) : undefined)}
              className={cn("w-full text-left", i > step && "pointer-events-none")}
            >
              <div className={cn("h-1 rounded-full", i <= step ? "bg-signal" : "bg-border")} />
              <div className={cn("mt-2 text-xs font-medium", i === step ? "text-foreground" : "text-muted-foreground")}>
                {i + 1}. {s}
              </div>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Where and when</CardTitle>
            <CardDescription>Pick a city to include all of its airports, or a specific airport.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup value={prefs.tripType} onValueChange={(v) => setPrefs({ tripType: v as "round_trip" | "one_way" })} className="grid grid-cols-2 gap-2 sm:w-80">
              <RadioCard value="round_trip" className="justify-center py-2.5 font-medium">Round trip</RadioCard>
              <RadioCard value="one_way" className="justify-center py-2.5 font-medium">One way</RadioCard>
            </RadioGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" error={err("origin")}>
                <PlaceCombobox value={input.originCode} onChange={(c) => set("originCode", c)} placeholder="City or airport" invalid={!!err("origin")} />
              </Field>
              <Field label="To" error={err("destination")}>
                <PlaceCombobox value={input.destinationCode} onChange={(c) => set("destinationCode", c)} placeholder="City or airport" invalid={!!err("destination")} icon="pin" />
              </Field>
            </div>
            {(originAirports.length > 0 || destAirports.length > 0) && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                {originAirports.length > 0 && (
                  <span>
                    Departure airports:{" "}
                    {originAirports.map((a) => <Badge key={a} variant="secondary" className="ml-1 font-mono">{a}</Badge>)}
                  </span>
                )}
                {destAirports.length > 0 && (
                  <span>
                    Arrival airports:{" "}
                    {destAirports.map((a) => <Badge key={a} variant="secondary" className="ml-1 font-mono" title={getAirport(a)?.name}>{a}</Badge>)}
                  </span>
                )}
              </div>
            )}
            <ToggleRow
              title="Allow nearby airports"
              description="Also accept airports within 200 km of your chosen origin and destination."
              checked={prefs.allowNearbyAirports}
              onChange={(v) => setPrefs({ allowNearbyAirports: v })}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Departure date" error={err("departureDate")} htmlFor="dep">
                <Input id="dep" type="date" min={addDays(today, 1)} value={input.departureDate} aria-invalid={!!err("departureDate")} onChange={(e) => set("departureDate", e.target.value)} />
              </Field>
              {prefs.tripType === "round_trip" && (
                <Field label="Return date" error={err("returnDate")} htmlFor="ret">
                  <Input id="ret" type="date" min={input.departureDate || addDays(today, 1)} value={input.returnDate ?? ""} aria-invalid={!!err("returnDate")} onChange={(e) => set("returnDate", e.target.value)} />
                </Field>
              )}
              <Field label="Flexible dates" htmlFor="flex" hint={prefs.flexibleDays ? "You authorize these alternative dates." : "Only the exact dates."}>
                <Select id="flex" value={prefs.flexibleDays} onChange={(e) => setPrefs({ flexibleDays: Number(e.target.value) })}>
                  <option value={0}>Exact dates</option>
                  <option value={1}>± 1 day</option>
                  <option value={2}>± 2 days</option>
                  <option value={3}>± 3 days</option>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Flight preferences</CardTitle>
            <CardDescription>These are hard rules: FareBuddy never books an itinerary that breaks one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label id="outw">Outbound departure time</Label>
              <WindowPicker id="outw" value={prefs.outboundTimeWindow} onChange={(v) => setPrefs({ outboundTimeWindow: v })} />
            </div>
            {prefs.tripType === "round_trip" && (
              <div className="space-y-2">
                <Label id="retw">Return departure time</Label>
                <WindowPicker id="retw" value={prefs.returnTimeWindow} onChange={(v) => setPrefs({ returnTimeWindow: v })} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cabin" htmlFor="cabin">
                <Select id="cabin" value={prefs.cabin} onChange={(e) => setPrefs({ cabin: e.target.value as CabinClass })}>
                  <option value="economy">Economy</option>
                  <option value="premium_economy">Premium economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </Select>
              </Field>
              <Field label="Max stops per direction" htmlFor="stops">
                <Select id="stops" value={prefs.maxStops} onChange={(e) => setPrefs({ maxStops: Number(e.target.value) })}>
                  <option value={0}>Nonstop only</option>
                  <option value={1}>Up to 1 stop</option>
                  <option value={2}>Up to 2 stops</option>
                  <option value={3}>Up to 3 stops</option>
                </Select>
              </Field>
              <Field label="Checked bags per passenger" htmlFor="bags" hint="Cost of required bags is included in the price comparison.">
                <Select id="bags" value={prefs.checkedBagsPerPassenger} onChange={(e) => setPrefs({ checkedBagsPerPassenger: Number(e.target.value) })}>
                  <option value={0}>None (carry-on only)</option>
                  <option value={1}>1 checked bag</option>
                  <option value={2}>2 checked bags</option>
                </Select>
              </Field>
              <Field label="Minimum connection time" htmlFor="mct">
                <Select id="mct" value={prefs.minConnectionMinutes} onChange={(e) => setPrefs({ minConnectionMinutes: Number(e.target.value) })}>
                  {[45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Max travel time per direction" htmlFor="maxdur">
                <Select id="maxdur" value={prefs.maxDurationHours ?? ""} onChange={(e) => setPrefs({ maxDurationHours: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">No limit</option>
                  {[6, 12, 18, 24, 30, 36, 42].map((h) => <option key={h} value={h}>{h} hours</option>)}
                </Select>
              </Field>
              <Field label="When several fares qualify" htmlFor="rank">
                <Select id="rank" value={prefs.ranking} onChange={(e) => setPrefs({ ranking: e.target.value as RankingStrategy })}>
                  <option value="lowest_price">Lowest total price</option>
                  <option value="shortest_duration">Shortest travel time</option>
                  <option value="fewest_stops">Fewest stops</option>
                  <option value="preferred_airline">Preferred airlines first</option>
                </Select>
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Preferred airlines <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <RadioGroup value={prefs.airlineMode} onValueChange={(v) => setPrefs({ airlineMode: v as "prefer" | "only" })} className="flex gap-2">
                  <RadioCard value="prefer" className="px-3 py-1.5 text-xs">Prefer</RadioCard>
                  <RadioCard value="only" className="px-3 py-1.5 text-xs">Only these</RadioCard>
                </RadioGroup>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AIRLINES.map((a) => {
                  const on = prefs.preferredAirlines.includes(a.code);
                  return (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => setPrefs({ preferredAirlines: on ? prefs.preferredAirlines.filter((c) => c !== a.code) : [...prefs.preferredAirlines, a.code] })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        on ? "border-signal bg-signal-soft font-medium text-signal" : "bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
              {prefs.airlineMode === "only" && prefs.preferredAirlines.length > 0 && (
                <p className="text-xs text-warn">Only itineraries operated entirely by the selected airlines will be considered.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow
                title="Accept alternative airport combinations"
                description="E.g. fly into NRT and out of HND, as long as both are authorized airports."
                checked={prefs.allowMixedAirports}
                onChange={(v) => setPrefs({ allowMixedAirports: v })}
              />
              <ToggleRow
                title="Accept multi-airline itineraries"
                description="Allow connections combining different airlines on one ticket."
                checked={prefs.allowMixedCarriers}
                onChange={(v) => setPrefs({ allowMixedCarriers: v })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Who’s flying</CardTitle>
            <CardDescription>Select a saved traveler profile for each passenger. Passenger details are sent only to the booking provider.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["adults", "Adults", "12+ years", 1],
                  ["children", "Children", "2–11 years", 0],
                  ["infants", "Infants", "Under 2, on lap", 0],
                ] as const
              ).map(([k, label, hint, min]) => (
                <div key={k} className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{hint}</div>
                  </div>
                  <Stepper label={label} value={prefs.passengers[k]} min={min} max={9} onChange={(v) => setPrefs({ passengers: { ...prefs.passengers, [k]: v } })} />
                </div>
              ))}
            </div>
            {err("passengers") && <p className="text-sm font-medium text-destructive">{err("passengers")}</p>}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>
                  Traveler profiles <span className="font-normal text-muted-foreground">({input.passengerProfileIds.length} of {paxTotal} selected)</span>
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setPaxDialog(true)}>
                  <UserPlus /> Add traveler
                </Button>
              </div>
              {(passengers ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No traveler profiles yet. Add one to continue.</div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(passengers ?? []).map((p) => {
                    const checked = input.passengerProfileIds.includes(p.id);
                    return (
                      <label key={p.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3", checked && "border-signal bg-signal-soft/50")}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            set("passengerProfileIds", v ? [...input.passengerProfileIds, p.id] : input.passengerProfileIds.filter((x) => x !== p.id))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{p.displayName}</div>
                          <div className="text-xs capitalize text-muted-foreground">
                            {p.passengerType} · {p.nationality}
                            {p.passportLast4 ? ` · passport ••${p.passportLast4}` : " · no passport"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              {input.passengerProfileIds.length !== paxTotal && (passengers ?? []).length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">You can save a draft now; select {paxTotal} profile{paxTotal > 1 ? "s" : ""} before activating.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Your price</CardTitle>
              <CardDescription>Amounts are the full payable total for all passengers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert>
                <Info />
                <AlertDescription>
                  The target price applies to the <strong className="text-foreground">entire eligible itinerary</strong>: outbound and return flights, taxes, mandatory fees and the checked baggage you require.
                </AlertDescription>
              </Alert>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Currency" htmlFor="cur" hint="Offers in other currencies are ignored (no FX conversion).">
                  <Select id="cur" value={input.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="Target total price" htmlFor="target" error={err("targetPrice")} hint="Book when the price is at or below this.">
                  <Input
                    id="target"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    value={input.targetPrice || ""}
                    aria-invalid={!!err("targetPrice")}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      // Keep the ceiling at least the target; follow the target until the user sets it apart.
                      setInput((x) => ({ ...x, targetPrice: v, maximumAuthorizedAmount: !x.maximumAuthorizedAmount || x.maximumAuthorizedAmount === x.targetPrice || x.maximumAuthorizedAmount < v ? v : x.maximumAuthorizedAmount }));
                    }}
                  />
                </Field>
                <Field label="Maximum total budget" htmlFor="max" error={err("maximumAuthorizedAmount")} hint="The hard ceiling FareBuddy may ever spend.">
                  <Input id="max" type="number" inputMode="decimal" min={1} value={input.maximumAuthorizedAmount || ""} aria-invalid={!!err("maximumAuthorizedAmount")} onChange={(e) => set("maximumAuthorizedAmount", Number(e.target.value))} />
                </Field>
                <Field label="Max price per passenger" htmlFor="ppp" hint="Optional.">
                  <Input
                    id="ppp"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={prefs.maxPricePerPassenger ?? ""}
                    onChange={(e) => setPrefs({ maxPricePerPassenger: e.target.value ? Number(e.target.value) : null })}
                  />
                </Field>
                <Field label="Price tolerance above maximum" htmlFor="tol" error={err("priceTolerance")} hint="Default 0 — never exceed your maximum.">
                  <Input id="tol" type="number" inputMode="decimal" min={0} value={input.priceTolerance} onChange={(e) => set("priceTolerance", Math.max(0, Number(e.target.value)))} />
                </Field>
                <Field label="Price check frequency" htmlFor="freq" hint={mode === "demo" ? `Demo runs ${status?.demoSpeed ?? 60}× faster.` : "Subject to provider rate limits."}>
                  <Select id="freq" value={input.monitoringIntervalMinutes} onChange={(e) => set("monitoringIntervalMinutes", Number(e.target.value))}>
                    {MONITORING_INTERVALS.map((i) => <option key={i.minutes} value={i.minutes}>{i.label}</option>)}
                  </Select>
                </Field>
              </div>

              {mode === "demo" && input.originCode && input.destinationCode && input.departureDate && (
                <div className="flex flex-col gap-3 rounded-xl border border-demo/30 bg-demo-soft p-4 sm:flex-row sm:items-center">
                  <FlaskConical className="h-5 w-5 shrink-0 text-demo" />
                  <div className="flex-1 text-sm">
                    {preview ? (
                      preview.cheapest !== null ? (
                        <>
                          Simulated market right now: cheapest eligible total <strong className="tabular">{money(preview.cheapest, input.currency)}</strong> ({preview.eligible} of {preview.seen} offers match your rules).
                        </>
                      ) : (
                        <>No simulated offers match your rules ({preview.seen} seen). Consider relaxing stops, times or airlines.</>
                      )
                    ) : (
                      <>Preview simulated fares for these rules to pick a realistic target.</>
                    )}
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={previewing}>
                    {previewing && <Loader2 className="animate-spin" />} Check simulated fares
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment method</CardTitle>
              <CardDescription>
                Charged only after the booking provider confirms. Flight purchases may be processed by the airline or booking provider rather than FareBuddy directly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(payments ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No payment methods yet.{" "}
                  <Link to="/app/payments" className="font-medium text-foreground underline">Add a card or wallet</Link> (your draft is kept if you save it first).
                </div>
              ) : (
                <RadioGroup value={input.paymentMethodId ?? ""} onValueChange={(v) => set("paymentMethodId", v)} className="grid gap-2 sm:grid-cols-2">
                  {(payments ?? []).map((p) => (
                    <RadioCard key={p.id} value={p.id} disabled={p.mode !== (original?.mode ?? mode)}>
                      {p.paymentType === "card" ? <CreditCard className="mt-0.5 h-4 w-4" /> : <Wallet className="mt-0.5 h-4 w-4" />}
                      <span className="min-w-0">
                        <span className="block font-medium">{p.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.paymentType === "stablecoin_wallet" ? `Balance ${money(p.confirmedBalance ?? 0, "USD", { decimals: true })} · funds reserved on activation` : "Hold placed at purchase, captured on confirmation"}
                        </span>
                      </span>
                    </RadioCard>
                  ))}
                </RadioGroup>
              )}
              {selectedPm?.paymentType === "stablecoin_wallet" && input.currency !== "USD" && (
                <p className="mt-2 text-xs text-destructive">Stablecoin wallets can only fund USD missions.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {changes.length > 0 && (
            <Alert variant="warn">
              <AlertTriangle />
              <AlertTitle>These edits change what you authorized</AlertTitle>
              <AlertDescription>
                Saving will revoke the current purchase authorization until you confirm again: {changes.join(", ")}.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-signal" /> Authorization summary
              </CardTitle>
              <CardDescription>FareBuddy may purchase only within these conditions. Review carefully.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {authorizationSummary(draft, selectedPm, selectedNames).map((line) => (
                  <li key={line} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                    <span>{line}</span>
                  </li>
                ))}
                <li className="flex gap-2.5 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                  <span>
                    Target {money(input.targetPrice, input.currency)} · checks {MONITORING_INTERVALS.find((i) => i.minutes === input.monitoringIntervalMinutes)?.label.toLowerCase()}
                  </span>
                </li>
              </ul>
              {(original?.mode ?? mode) === "demo" && (
                <Alert variant="demo" className="mt-5">
                  <FlaskConical />
                  <AlertDescription>Demo mission: offers, payments and any booking will be simulated and clearly labeled. Nothing is charged.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What may FareBuddy do without asking?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                title="Automatically purchase when the target is reached"
                description={autoPurchase ? "FareBuddy will book the best eligible fare within your authorization immediately." : "Off: FareBuddy alerts you and waits for your approval before buying."}
                checked={autoPurchase}
                onChange={setAutoPurchase}
              />
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <span>
                  {autoPurchase
                    ? consentText(draft)
                    : `I authorize FareBuddy to monitor fares and, only when I approve, purchase one itinerary matching every condition above for no more than ${money(input.maximumAuthorizedAmount, input.currency)}.`}
                </span>
              </label>
              {issues.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Before this mission can be activated</AlertTitle>
                  <AlertDescription>
                    <ul className="ml-4 list-disc space-y-1">
                      {issues.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="sticky bottom-20 z-10 mt-6 flex items-center gap-2 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <Button variant="ghost" onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}>
          <ArrowLeft /> {step === 0 ? "Cancel" : "Back"}
        </Button>
        <div className="ml-auto flex gap-2">
          {step >= 1 && (
            <Button variant="outline" onClick={() => save(false)} disabled={!!busy}>
              {busy === "draft" && <Loader2 className="animate-spin" />}
              {id ? "Save changes" : "Save draft"}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button variant="signal" onClick={() => save(true)} disabled={!consent || !!busy}>
              {busy === "activate" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Authorize & activate
            </Button>
          )}
        </div>
      </div>

      <Dialog open={paxDialog} onOpenChange={setPaxDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a traveler</DialogTitle>
            <DialogDescription>Only the details required by the booking provider are collected.</DialogDescription>
          </DialogHeader>
          <PassengerForm
            onCancel={() => setPaxDialog(false)}
            onSaved={(pid) => {
              setPaxDialog(false);
              set("passengerProfileIds", [...input.passengerProfileIds, pid]);
              toast.success("Traveler saved");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
