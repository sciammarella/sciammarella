import Link from "next/link";
import { History } from "lucide-react";
import { ConfidenceBadge, DemoBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { dateTimeBR } from "@/lib/format";
import { requireProfile } from "@/lib/session";
import { withUser } from "@/server/db";
import { listRecommendations } from "@/server/services/recommendations";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { portfolio_proposal: "Proposta de portfólio", agent_report: "Relatório do agente" };

export default async function RecommendationsPage() {
  const { user } = await requireProfile();
  const recs = await withUser(user.id, (tx) => listRecommendations(tx, 200));
  return (
    <>
      <PageHeader eyebrow="Histórico" title="Histórico de recomendações" description="Toda recomendação é registrada com justificativa, evidências, data dos dados, versão das metodologias e grau de confiança. Registros não podem ser editados." />
      {recs.length === 0 ? (
        <EmptyState icon={<History className="h-8 w-8" />} title="Nenhuma recomendação ainda" description="Gere propostas no Portfolio Builder ou peça um relatório ao Agente IA." />
      ) : (
        <div className="space-y-3">
          {recs.map((r) => (
            <Link key={r.id} href={`/recommendations/${r.id}`} className="block rounded-2xl border bg-card p-4 transition hover:border-foreground/30">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{KIND[r.kind] ?? r.kind}</Badge>
                <span className="font-semibold">{r.title}</span>
                <ConfidenceBadge value={r.confidence} />
                {r.uses_demo_data && <DemoBadge label="dados demo" />}
                <span className="ml-auto text-xs text-muted-foreground">{dateTimeBR(r.created_at)} · {r.generator === "rules" ? "motor de regras" : r.generator}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{r.summary}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
