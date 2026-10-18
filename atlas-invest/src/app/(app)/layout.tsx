import Link from "next/link";
import { FlaskConical, LogOut } from "lucide-react";
import { Nav } from "@/components/nav";
import { signOutAction } from "@/app/actions";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { listSources } from "@/server/services/market-data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireProfile();
  const { openAlerts, liveSources } = await withUser(user.id, async (tx) => {
    const [a] = await tx.query<{ n: number }>(`select count(*)::int as n from alerts where status = 'open' and severity in ('critical','attention')`);
    const sources = await listSources(tx);
    return { openAlerts: a?.n ?? 0, liveSources: sources.filter((s) => !s.is_demo && s.status === "ok").length };
  });
  const footer = (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <div className="px-2 text-xs text-slate-400">
        <div className="truncate font-medium text-slate-200">{user.displayName}</div>
        <div className="truncate">{user.email}</div>
        <div className="mt-1">Perfil {profile.derived.label} · {profile.answers.baseCurrency}</div>
      </div>
      <form action={signOutAction}>
        <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /> Sair</button>
      </form>
    </div>
  );
  return (
    <div className="min-h-screen">
      <Nav alerts={openAlerts} footer={footer} />
      <div className="lg:pl-60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-demo/20 bg-demo-soft px-4 py-2 text-xs text-demo sm:px-8">
          <FlaskConical className="h-3.5 w-3.5" />
          <span className="font-semibold">Ambiente de demonstração.</span>
          <span>
            {liveSources > 0 ? `${liveSources} fonte(s) real(is) ativa(s); ` : "Nenhuma fonte real disponível no momento; "}
            valores marcados <b>DEMO</b> são simulados. Análises informativas — não são ordens de investimento.
          </span>
          <Link href="/settings#fontes" className="underline underline-offset-2">Fontes de dados</Link>
        </div>
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
