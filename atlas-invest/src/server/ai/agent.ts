// AIInvestmentAgent — produces evidence-backed reports and answers.
// With ANTHROPIC_API_KEY, Claude orchestrates the deterministic tools and writes
// the narrative. Without it, a rules-based analyst calls the same tools and fills
// a fixed template. Either way every tool output is stored as evidence.

import { ASSET_CLASS_SHORT, type AssetClass } from "@/domain/types";
import { withUser } from "@/server/db";
import { getProfile, type StoredProfile } from "@/server/services/profile";
import { listPortfolios } from "@/server/services/portfolio";
import { saveRecommendation, type EvidenceInput } from "@/server/services/recommendations";
import { todayISO } from "@/server/services/market-data";
import { execTool, pickProvider, type ToolCallRecord } from "./providers";
import { TOOLS, type ToolContext } from "./tools";

const SYSTEM_PROMPT = `Você é o Atlas, um agente de análise de investimentos para investidores do Brasil e dos EUA. Responda em português do Brasil.

Regras:
- Todo número que você citar (retornos, riscos, pesos, probabilidades, valores) deve vir das ferramentas. Não calcule nem estime métricas por conta própria; se precisar de um número que nenhuma ferramenta fornece, diga que não está disponível.
- Retornos projetados são cenários de modelo, nunca garantias. Diferencie sempre dado histórico de projeção.
- Se os dados forem de demonstração (dataOrigin "demo", usesDemoData, demoShare > 0) ou estiverem desatualizados, diga isso explicitamente.
- Se a meta de rentabilidade do usuário não for compatível com o perfil de risco, diga isso claramente; não sugira ativos mais arriscados só para atingir a meta.
- Não execute nem sugira ordens de compra e venda com quantidades. Você faz análise e recomendação de postura (manter, rebalancear, revisar, reduzir exposição). Use get_review_signals para basear a postura final.
- Não compare diretamente métricas incompatíveis entre classes (ex.: volatilidade de renda fixa vs. cripto) sem explicar a diferença.
- Indique a data dos dados e o grau de confiança (baixa/média/alta) conforme a qualidade dos dados.
- Formato: Markdown curto com as seções "Resumo", "Análise", "Riscos principais", "Recomendação" e "Limitações dos dados". Termine lembrando que se trata de análise informativa e não de uma ordem de investimento.`;

export interface AgentReportInput {
  question?: string;
  portfolioId?: string;
}

export async function generateAgentReport(userId: string, input: AgentReportInput): Promise<string> {
  const { profile, portfolios } = await withUser(userId, async (tx) => ({ profile: await getProfile(tx), portfolios: await listPortfolios(tx) }));
  if (!profile) throw new Error("Configure seu perfil de investimento antes de usar o agente.");
  const portfolio = portfolios.find((p) => p.id === input.portfolioId) ?? portfolios[0] ?? null;
  const question = input.question?.trim().slice(0, 2000) || null;
  const ctx: ToolContext = { userId, profile };

  const provider = pickProvider();
  let text: string;
  let calls: ToolCallRecord[];
  let generator: string;
  if (provider) {
    const prompt = [
      `Data de hoje: ${todayISO()}.`,
      portfolio ? `Portfólio em foco: "${portfolio.name}" (id ${portfolio.id}).` : "O usuário ainda não tem portfólios salvos.",
      question ? `Pergunta do usuário: ${question}` : "Produza um relatório de revisão do portfólio em foco, incluindo oportunidades compatíveis com o perfil.",
    ].join("\n");
    try {
      const r = await provider.run({ system: SYSTEM_PROMPT, prompt, tools: TOOLS, ctx });
      text = r.text;
      calls = r.toolCalls;
      generator = r.generator;
    } catch (e) {
      const fallback = await rulesReport(ctx, profile, portfolio?.id ?? null, question);
      text = `> O provedor de IA falhou (${(e as Error).message}). Relatório gerado pelo analista por regras.\n\n${fallback.text}`;
      calls = fallback.calls;
      generator = "rules";
    }
  } else {
    const r = await rulesReport(ctx, profile, portfolio?.id ?? null, question);
    text = r.text;
    calls = r.calls;
    generator = "rules";
  }

  const analytics = calls.find((c) => c.name === "get_portfolio_analytics" && !c.error)?.output as { demoShare?: number; dataAsOf?: string } | undefined;
  const opps = calls.find((c) => c.name === "search_opportunities" && !c.error)?.output as { dataOrigin: string | null }[] | undefined;
  const usesDemo = (analytics?.demoShare ?? 0) > 0 || (opps ?? []).some((o) => o.dataOrigin !== "real");
  const failed = calls.filter((c) => c.error).length;
  const confidenceScore = Math.max(20, (usesDemo ? 55 : 82) - failed * 10 - (calls.length === 0 ? 30 : 0));
  const evidence: EvidenceInput[] = calls.map((c) => ({
    label: `${c.name}(${Object.keys(c.input).length ? JSON.stringify(c.input) : ""})`,
    value: c.error ? { error: c.error } : c.output,
    source: "Ferramentas determinísticas do Atlas",
    dataAsOf: analytics?.dataAsOf ?? todayISO(),
    isDemo: usesDemo,
  }));
  const summary = (text.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">")) ?? "").replace(/[*_`]/g, "").slice(0, 400);
  return withUser(userId, (tx) =>
    saveRecommendation(tx, userId, {
      portfolioId: portfolio?.id ?? null,
      kind: "agent_report",
      title: question ? `Pergunta: ${question.slice(0, 90)}` : `Relatório de revisão — ${portfolio?.name ?? "perfil"}`,
      summary,
      body: { markdown: text, question, portfolioId: portfolio?.id ?? null, toolCalls: calls.map((c) => ({ name: c.name, input: c.input, error: c.error ?? null })) },
      confidenceScore,
      dataAsOf: analytics?.dataAsOf ?? todayISO(),
      usesDemoData: usesDemo,
      generator,
      evidence,
    }),
  );
}

const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

/** Deterministic analyst: same tools, fixed template. */
async function rulesReport(ctx: ToolContext, profile: StoredProfile, portfolioId: string | null, question: string | null): Promise<{ text: string; calls: ToolCallRecord[] }> {
  const calls: ToolCallRecord[] = [];
  const call = async <T,>(name: string, input: Record<string, unknown> = {}): Promise<T> => {
    const r = await execTool(TOOLS, ctx, name, input);
    calls.push(r);
    return (r.error ? { error: r.error } : r.output) as T;
  };
  await call("get_profile");
  type PA = { name: string; totalValue: number; baseCurrency: string; expectedReturn: number; volatility: number; range: { pessimistic: number; base: number; optimistic: number }; probabilityOfLoss: number; horizonYears: number; risk: { score: number; category: string; explanation: string; limitations: string[] }; byClass: { class: string; weight: number }[]; stress: { scenario: string; impact: number }[]; riskFactors: string[]; demoShare: number; estimatedShare: number; liquidity: { d1: number; d5: number }; costs: { weightedFee: number }; dataAsOf: string; error?: string };
  const pa: PA | null = portfolioId ? await call<PA>("get_portfolio_analytics", { portfolio_id: portfolioId }) : null;
  const signals = portfolioId ? await call<{ posture: string; reasons: string[]; error?: string }>("get_review_signals", { portfolio_id: portfolioId }) : null;
  const alertsRaw = await call<{ severity: string; title: string; status: string }[] | { error: string }>("get_recent_alerts", { limit: 5 });
  const alerts = Array.isArray(alertsRaw) ? alertsRaw : [];
  type Opp = { symbol: string; name: string; class: string; scenarios: { pessimistic: number; base: number; optimistic: number } | null; risk: number; riskCategory: string; compatibility: string; dataOrigin: string | null };
  const oppsRaw = await call<Opp[] | { error: string }>("search_opportunities", { limit: 5, max_risk: profile.derived.maxRiskScore });
  const opps = Array.isArray(oppsRaw) ? oppsRaw : [];

  const d = profile.derived;
  const a = profile.answers;
  const lines: string[] = [];
  lines.push("## Resumo");
  if (question) lines.push(`Pergunta recebida: _${question}_. O analista por regras não interpreta perguntas livres; abaixo está a análise padrão com os dados disponíveis. Configure ANTHROPIC_API_KEY para respostas em linguagem natural.`);
  if (pa && !pa.error) {
    lines.push(`A carteira **${pa.name}** tem valor estimado de ${pa.baseCurrency} ${pa.totalValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}, risco consolidado **${pa.risk.score}/10 (${pa.risk.category})** e retorno esperado no cenário-base de **${pct(pa.expectedReturn)} a.a.** (faixa de ${pct(pa.range.pessimistic)} a ${pct(pa.range.optimistic)} a.a. em ${pa.horizonYears} ano(s)). Postura sugerida: **${signals?.posture ?? "—"}**.`);
  } else {
    lines.push("Nenhum portfólio com posições para analisar. Use o Portfolio Builder para criar um.");
  }
  lines.push("", "## Análise");
  lines.push(`Perfil **${d.label}**: risco máximo ${d.maxRiskScore}/10, queda tolerável de ${pct(d.maxDrawdown, 0)}, meta de ${pct(a.targetReturn)} a.a.`);
  if (pa && !pa.error) {
    lines.push(`Alocação por classe: ${pa.byClass.map((c) => `${ASSET_CLASS_SHORT[c.class as AssetClass] ?? c.class} ${pct(c.weight, 0)}`).join(", ")}.`);
    lines.push(`Probabilidade estimada de terminar o horizonte com perda nominal: ${pct(pa.probabilityOfLoss)} (modelo lognormal). Liquidez em até 5 dias: ${pct(pa.liquidity.d1 + pa.liquidity.d5, 0)}. Custo médio ponderado: ${pct(pa.costs.weightedFee, 2)} a.a.`);
    lines.push(pa.expectedReturn >= a.targetReturn ? `O cenário-base atinge a meta de ${pct(a.targetReturn)}, mas cenário-base não é garantia.` : `O cenário-base (${pct(pa.expectedReturn)}) está abaixo da meta de ${pct(a.targetReturn)}. Aumentar o risco além do seu perfil para alcançá-la não é recomendado.`);
  }
  if (opps.length) {
    lines.push("", "Oportunidades compatíveis com o perfil (cenário-base estimado):");
    for (const o of opps) lines.push(`- **${o.symbol}** (${o.class}) — risco ${o.risk}/10, base ${pct(o.scenarios?.base)} a.a. (${pct(o.scenarios?.pessimistic)} a ${pct(o.scenarios?.optimistic)}), compatibilidade ${o.compatibility}${o.dataOrigin !== "real" ? " · dados demo" : ""}`);
  }
  lines.push("", "## Riscos principais");
  if (pa && !pa.error) {
    for (const f of pa.riskFactors.slice(0, 5)) lines.push(`- ${f}`);
    const worst = [...pa.stress].sort((x, y) => x.impact - y.impact)[0];
    if (worst) lines.push(`- Teste de estresse mais severo: ${worst.scenario} (${pct(worst.impact)}).`);
  }
  const openAlerts = alerts.filter((x) => x.status === "open");
  if (openAlerts.length) lines.push(`- Alertas em aberto: ${openAlerts.map((x) => `${x.title} (${x.severity})`).join("; ")}.`);
  lines.push("", "## Recomendação");
  if (signals && !signals.error) {
    lines.push(`**${signals.posture[0].toUpperCase()}${signals.posture.slice(1)}.**`);
    for (const r of signals.reasons) lines.push(`- ${r}`);
  } else lines.push("Crie ou selecione um portfólio para receber uma recomendação de postura.");
  lines.push("", "## Limitações dos dados");
  if (pa && !pa.error) {
    for (const l of pa.risk.limitations.slice(0, 4)) lines.push(`- ${l}`);
    lines.push(`- Dados até ${pa.dataAsOf}.`);
  }
  lines.push("- Relatório gerado pelo analista por regras (sem modelo de linguagem).");
  lines.push("", "_Análise informativa; não constitui ordem de investimento nem garantia de resultado._");
  return { text: lines.join("\n"), calls };
}
