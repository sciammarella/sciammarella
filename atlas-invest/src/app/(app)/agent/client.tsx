"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { agentReportAction } from "@/app/actions";

const SUGGESTIONS = [
  "Minha meta de rentabilidade é compatível com o meu perfil?",
  "Quais são os maiores riscos da minha carteira hoje?",
  "Compare Tesouro IPCA+ 2035, BOVA11 e um fundo de T-Bills tokenizado para o meu horizonte.",
  "Devo manter, rebalancear ou reduzir exposição a cripto?",
];

export function AgentForm({ portfolios, llm }: { portfolios: { id: string; name: string }[]; llm: boolean }) {
  const [question, setQuestion] = useState("");
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (q?: string) =>
    start(async () => {
      const r = await agentReportAction({ question: q, portfolioId: portfolioId || undefined });
      if (r.ok && r.data) { router.push(`/agent?rec=${r.data.recommendationId}`); router.refresh(); }
      else if (!r.ok) toast.error(r.error);
    });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
        <div className="space-y-1.5"><Label>Portfólio em foco</Label>
          <NativeSelect value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>{portfolios.length === 0 && <option value="">Nenhum</option>}{portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
        </div>
        <div className="space-y-1.5"><Label>Pergunta (opcional)</Label><Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={llm ? "Pergunte sobre sua carteira, oportunidades ou riscos…" : "Perguntas livres exigem ANTHROPIC_API_KEY; sem ela, o relatório padrão é gerado."} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="brand" disabled={pending} onClick={() => go()}><FileText /> {pending ? "Analisando…" : "Gerar relatório de revisão"}</Button>
        <Button variant="outline" disabled={pending || !question.trim()} onClick={() => go(question)}><Send /> Perguntar</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map((s) => <button key={s} className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setQuestion(s)}>{s}</button>)}</div>
    </div>
  );
}
