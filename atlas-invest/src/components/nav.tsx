"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, Bot, Briefcase, Compass, History, LayoutDashboard, Menu, Settings, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/discover", label: "Descobrir", icon: Compass },
  { href: "/builder", label: "Portfolio Builder", icon: Sparkles },
  { href: "/portfolios", label: "Portfólios", icon: Briefcase },
  { href: "/alerts", label: "Alertas", icon: Bell, badgeKey: "alerts" as const },
  { href: "/agent", label: "Agente IA", icon: Bot },
  { href: "/recommendations", label: "Recomendações", icon: History },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function Nav({ alerts, footer }: { alerts: number; footer: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((it) => {
        const active = path === it.href || path.startsWith(`${it.href}/`) || (it.href === "/portfolios" && path.startsWith("/portfolios"));
        const Icon = it.icon;
        return (
          <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}>
            <Icon className="h-4 w-4" />
            <span className="flex-1">{it.label}</span>
            {it.badgeKey === "alerts" && alerts > 0 && <span className="rounded-full bg-critical px-1.5 text-[11px] font-semibold text-white">{alerts}</span>}
          </Link>
        );
      })}
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-sky-600 text-sm font-bold text-white">A</span>
      <span className="leading-tight text-white">
        <span className="block text-sm font-semibold">Atlas Invest AI</span>
        <span className="block text-[11px] text-slate-400">Investment Copilot</span>
      </span>
    </Link>
  );
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 bg-[hsl(224_50%_11%)] px-3 py-5 lg:flex">
        {brand}
        {links}
        <div className="mt-auto">{footer}</div>
      </aside>
      <header className="sticky top-0 z-30 flex items-center justify-between bg-[hsl(224_50%_11%)] px-4 py-3 lg:hidden">
        {brand}
        <button aria-label="Abrir menu" onClick={() => setOpen(true)} className="rounded-md p-2 text-white"><Menu className="h-5 w-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-[hsl(224_50%_11%)] px-3 py-5">
            <div className="flex items-center justify-between">{brand}<button aria-label="Fechar menu" onClick={() => setOpen(false)} className="p-2 text-white"><X className="h-5 w-5" /></button></div>
            {links}
            <div className="mt-auto">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
