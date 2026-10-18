import Link from "next/link";
import { Briefcase } from "lucide-react";
import { RiskBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { dateBR, money, pct } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { listPortfolios, portfolioView } from "@/server/services/portfolio";
import { NewPortfolioButton, PortfolioRowActions } from "./client";

export const dynamic = "force-dynamic";

const STRATEGY: Record<string, string> = { conservative: "Conservadora", balanced: "Equilibrada", aggressive: "Agressiva", custom: "Personalizada" };

export default async function PortfoliosPage() {
  const { user, profile } = await requireProfile();
  const rows = await withUser(user.id, async (tx) => {
    const list = await listPortfolios(tx);
    const out = [];
    for (const p of list) out.push({ p, a: (await portfolioView(tx, p.id, profile.derived.horizonYears, false))?.analytics ?? null });
    return out;
  });
  return (
    <>
      <PageHeader eyebrow="Portfólios" title="Seus portfólios" description="Crie, edite, duplique e acompanhe múltiplos portfólios. Todos entram no monitoramento diário." actions={<NewPortfolioButton />} />
      {rows.length === 0 ? (
        <EmptyState icon={<Briefcase className="h-8 w-8" />} title="Nenhum portfólio" description="Crie um portfólio vazio para registrar posições manualmente, ou use o Portfolio Builder." action={<NewPortfolioButton />} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ p, a }) => (
            <Card key={p.id} className="transition hover:border-foreground/30">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/portfolios/${p.id}`} className="min-w-0">
                    <div className="truncate font-semibold hover:underline">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{STRATEGY[p.strategy] ?? p.strategy} · {p.positions} posições · criado em {dateBR(p.created_at)}</div>
                  </Link>
                  <PortfolioRowActions id={p.id} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">Valor</div><div className="font-semibold tabular">{money(a?.totalValue ?? 0, p.base_currency)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Retorno esp.</div><div className="font-semibold tabular">{a ? pct(a.expectedReturn) : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Risco</div>{a ? <RiskBadge score={a.risk.score} compact /> : "—"}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
