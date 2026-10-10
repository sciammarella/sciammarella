import { Bell, CreditCard, FlaskConical, LayoutDashboard, LogOut, Plane, Plus, Settings, Ticket, Users } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Logo, LogoMark } from "@/components/Logo";
import { ModeBadge } from "@/components/ModeBadge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBackend, useData } from "@/hooks/backend";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/missions", label: "Missions", icon: Plane },
  { to: "/app/bookings", label: "Bookings", icon: Ticket },
  { to: "/app/passengers", label: "Passengers", icon: Users },
  { to: "/app/payments", label: "Payments", icon: CreditCard },
  { to: "/app/notifications", label: "Notifications", icon: Bell },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[5]];

function DemoBanner() {
  const { status } = useBackend();
  if (!status || status.mode !== "demo") return null;
  return (
    <div className="border-b border-demo/20 bg-demo-soft">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-xs text-foreground/80 lg:px-8">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-demo" />
        <span className="min-w-0 truncate">
          <strong className="font-semibold text-demo">Demo mode</strong> — fares, payments and bookings are simulated. No real money moves and no real tickets are issued.
        </span>
        <Link to="/app/settings" className="ml-auto shrink-0 font-medium text-demo hover:underline">
          Integration status
        </Link>
      </div>
    </div>
  );
}

export function AppShell() {
  const { backend, session, status } = useBackend();
  const navigate = useNavigate();
  const { data: notifications } = useData((b) => b.listNotifications(), []);
  const unread = (notifications ?? []).filter((n) => !n.readAt).length;
  const initials = (session?.fullName || session?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link to="/app">
            <Logo />
          </Link>
        </div>
        <div className="px-3">
          <Button asChild className="w-full justify-start" variant="signal">
            <Link to="/app/missions/new">
              <Plus /> New flight mission
            </Link>
          </Button>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  isActive && "bg-accent text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.label === "Notifications" && unread > 0 && (
                <span className="ml-auto rounded-full bg-signal px-1.5 text-[10px] font-semibold text-signal-foreground">{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-4 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Runtime</span>
            {status && <ModeBadge mode={status.mode} />}
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span>Scheduler</span>
            <span className="font-medium text-foreground">{status?.scheduler === "server" ? "Server (pg_cron)" : "This browser"}</span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 lg:h-16 lg:px-8">
            <Link to="/app" className="lg:hidden">
              <LogoMark className="h-7 w-7" />
            </Link>
            <div className="lg:hidden">{status && <ModeBadge mode={status.mode} />}</div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button asChild variant="signal" size="sm" className="lg:hidden">
                <Link to="/app/missions/new">
                  <Plus /> Mission
                </Link>
              </Button>
              <Button variant="ghost" size="icon" className="relative" onClick={() => navigate("/app/notifications")} aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-signal ring-2 ring-background" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-label="Account">
                    {initials}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium text-foreground">{session?.fullName || "Traveler"}</div>
                    <div className="truncate">{session?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/app/passengers")}>
                    <Users /> Passengers
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/app/payments")}>
                    <CreditCard /> Payment methods
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/app/settings")}>
                    <Settings /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={async () => {
                      await backend.signOut();
                      navigate("/");
                    }}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <DemoBanner />
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn("relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground", isActive && "text-foreground")}
          >
            <item.icon className="h-5 w-5" />
            {item.label === "Notifications" ? "Alerts" : item.label}
            {item.label === "Notifications" && unread > 0 && <span className="absolute right-[30%] top-2 h-2 w-2 rounded-full bg-signal" />}
          </NavLink>
        ))}
        <NavLink to="/app/settings" className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground", isActive && "text-foreground")}>
          <Settings className="h-5 w-5" />
          More
        </NavLink>
      </nav>
    </div>
  );
}
