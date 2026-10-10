import { ArrowRight, BadgeCheck, Bot, CheckCircle2, CircleDollarSign, Coins, CreditCard, Eye, FlaskConical, Lock, Radar, ScrollText, ShieldCheck, SlidersHorizontal, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Sparkline } from "@/components/PriceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/backend";

const SPARK = [1412, 1388, 1395, 1351, 1364, 1302, 1318, 1276, 1290, 1221, 1238, 1184, 1172, 1196, 1129, 1104, 1118, 1061, 1043, 992];

function HeroMission() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-signal/20 via-transparent to-demo/10 blur-2xl" />
      <div className="rounded-3xl border bg-card p-5 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Flight mission</div>
            <div className="mt-1 font-display text-xl font-semibold">Vitória → Tokyo</div>
            <div className="text-sm text-muted-foreground">Dec 25 – Jan 12 · 1 adult · Economy</div>
          </div>
          <Badge variant="signal" className="gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
            Target reached
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-xs text-muted-foreground">Best eligible</div>
            <div className="font-display text-lg font-semibold tabular text-signal">$992</div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-xs text-muted-foreground">Your target</div>
            <div className="font-display text-lg font-semibold tabular">$1,000</div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-xs text-muted-foreground">Saved</div>
            <div className="font-display text-lg font-semibold tabular">$420</div>
          </div>
        </div>

        <Sparkline values={SPARK} className="mt-5 h-16 w-full text-foreground" />

        <ol className="mt-5 space-y-2.5 border-t pt-4 text-sm">
          {[
            { icon: Radar, text: "Checked 214 offers · 37 meet every condition", muted: true },
            { icon: Target, text: "VIX → GRU → DOH → HND at $992 incl. 1 bag", muted: false },
            { icon: ShieldCheck, text: "Revalidated price · within your $1,000 limit", muted: false },
            { icon: BadgeCheck, text: "Provider confirmed · PNR K7QX2M", muted: false },
          ].map((l, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${l.muted ? "bg-secondary text-muted-foreground" : "bg-signal-soft text-signal"}`}>
                <l.icon className="h-3.5 w-3.5" />
              </span>
              <span className={l.muted ? "text-muted-foreground" : ""}>{l.text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11px] text-muted-foreground">Illustrative example.</p>
      </div>
    </div>
  );
}

const BENEFITS = [
  {
    icon: Radar,
    title: "Smart price monitoring",
    body: "FareBuddy checks the market on a server-side schedule, normalizes taxes, fees and baggage, and only counts itineraries that meet every condition you set.",
  },
  {
    icon: Bot,
    title: "Autonomous booking",
    body: "When an eligible total hits your target, it revalidates the price, holds payment, books, and waits for the provider's confirmation — never a guess.",
  },
  {
    icon: Coins,
    title: "Cards or stablecoins",
    body: "Pay with a tokenized card or a pre-funded USDC/USDT wallet. Wallet funds are earmarked per mission so the same balance can't be spent twice.",
  },
];

const STEPS = [
  { icon: SlidersHorizontal, title: "Configure", body: "Route, dates, cabin, stops, baggage, passengers and the most you'll pay — including taxes and required bags." },
  { icon: Eye, title: "Monitor", body: "FareBuddy tracks eligible fares around the clock and shows every check, price and decision in an audit log." },
  { icon: CheckCircle2, title: "Book", body: "At or below target, it books within your exact authorization and sends the confirmed itinerary to you." },
];

const GUARANTEES = [
  { icon: Lock, title: "Opt-in, always", body: "Automatic purchase is off until you review an explicit authorization summary and consent." },
  { icon: CircleDollarSign, title: "Hard spending ceiling", body: "Zero tolerance above your maximum by default. If the price moves up at checkout, FareBuddy stops." },
  { icon: Target, title: "No silent substitutions", body: "Dates, airports, cabin and passengers outside your authorization are never selected." },
  { icon: ScrollText, title: "Auditable", body: "Every price check, authorization change, payment event and confirmation is logged." },
];

export default function Landing() {
  const { session } = useBackend();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-transparent bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
          <nav className="ml-10 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#trust" className="hover:text-foreground">Safeguards</a>
            <a href="#payments" className="hover:text-foreground">Payments</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <Button asChild size="sm">
                <Link to="/app">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/signin">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <Badge variant="outline" className="mb-6 gap-1.5 bg-card py-1 pl-1.5 pr-3 text-xs">
              <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-foreground">Agent</span>
              Your autonomous travel purchaser
            </Badge>
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] sm:text-6xl">
              Your next flight.
              <br />
              Your price.
              <br />
              <span className="text-signal">Already booked.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Set your destination and target price. FareBuddy watches the market and books your flight when the right deal appears.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="signal">
                <Link to={session ? "/app/missions/new" : "/signup"}>
                  Create a Flight Mission <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">See How It Works</a>
              </Button>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5 text-demo" />
              Try the full workflow in demo mode — simulated fares and payments, no money spent.
            </p>
          </div>
          <HeroMission />
        </div>
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} id={b.icon === Coins ? "payments" : undefined}>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <b.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <div className="text-sm font-semibold uppercase tracking-wider text-signal">How it works</div>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Configure → Monitor → Book</h2>
          <p className="mt-3 text-muted-foreground">Like handing a precise purchase order to an assistant who never sleeps — and never exceeds it.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-soft text-signal">
                  <s.icon className="h-5 w-5" />
                </div>
                <span className="font-display text-4xl font-semibold text-muted-foreground/25">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              {i < STEPS.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 rounded-full border bg-background p-1 text-muted-foreground md:block" />}
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border bg-muted/40 p-5 text-sm text-muted-foreground">
          <strong className="text-foreground">What “target price” means:</strong> the full payable total for the entire itinerary — outbound and return flights, taxes, mandatory fees and any baggage you require — for all passengers.
        </div>
      </section>

      <section id="trust" className="scroll-mt-20 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-sm font-semibold uppercase tracking-wider text-signal">Safeguards</div>
            <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">An agent that spends money should earn trust.</h2>
            <p className="mt-3 text-primary-foreground/70">
              FareBuddy only says a flight is booked when the booking provider confirms it. Uncertain outcomes are reconciled with the provider before anything is retried.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 p-5">
                <g.icon className="h-5 w-5 text-signal" />
                <h3 className="mt-4 font-semibold">{g.title}</h3>
                <p className="mt-1.5 text-sm text-primary-foreground/70">{g.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="flex gap-4 rounded-2xl border border-primary-foreground/10 p-5">
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
              <p className="text-sm text-primary-foreground/80">
                Cards are tokenized by a PCI-compliant provider — FareBuddy never stores card numbers or CVVs. Flights may be ticketed by the airline or booking provider.
              </p>
            </div>
            <div className="flex gap-4 rounded-2xl border border-primary-foreground/10 p-5">
              <Coins className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
              <p className="text-sm text-primary-foreground/80">
                USDC/USDT deposits count only after the required network confirmations. No private keys are ever collected.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-semibold sm:text-4xl">Name your price. Get back to your life.</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Create a mission in two minutes and watch FareBuddy work — start in demo mode, go live when integrations are configured.</p>
        <Button asChild size="lg" variant="signal" className="mt-8">
          <Link to={session ? "/app/missions/new" : "/signup"}>
            Create a Flight Mission <ArrowRight />
          </Link>
        </Button>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <Logo className="scale-90" />
          <span className="sm:ml-auto">Demo mode bookings are simulations and are never real reservations.</span>
        </div>
      </footer>
    </div>
  );
}
