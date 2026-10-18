import Link from "next/link";
import { CMA_METHODOLOGY_VERSION } from "@/domain/analytics";
import { ALERT_RULES_VERSION } from "@/domain/alerts";
import { BUILDER_METHODOLOGY_VERSION } from "@/domain/builder";
import { PROFILE_METHODOLOGY_VERSION } from "@/domain/profile";
import { RISK_METHODOLOGY_VERSION } from "@/domain/risk";
import { STRESS_SCENARIOS } from "@/domain/portfolio";

export const metadata = { title: "Metodologia e limitações — Atlas Invest AI" };

function Section({ id, title, version, children }: { id: string; title: string; version?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t py-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      {version && <div className="mt-1 font-mono text-xs text-muted-foreground">{version}</div>}
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_b]:text-foreground [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </section>
  );
}

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">← Atlas Invest AI</Link>
      <h1 className="mt-4 text-3xl font-semibold">Metodologia, fontes e limitações</h1>
      <p className="mt-2 text-muted-foreground">Tudo o que o Atlas calcula é feito por funções determinísticas e versionadas. O modelo de linguagem apenas explica resultados — nunca estima métricas.</p>

      <Section id="perfil" title="Perfil de investimento" version={PROFILE_METHODOLOGY_VERSION}>
        <p>O nível de risco (1 Conservador a 4 Agressivo) é o <b>menor</b> entre: tolerância a perdas declarada, horizonte, necessidade de liquidez, objetivo e experiência. A meta de rentabilidade <b>não</b> entra nesse cálculo.</p>
        <p>Do nível derivam: nota de risco máxima da carteira (3/5/6/8), queda tolerável (5%/15%/30%/50%), limites de cripto e tokenizados e a fatia mínima com liquidez em até 5 dias úteis.</p>
      </Section>

      <Section id="risco" title="Risk Intelligence Engine" version={RISK_METHODOLOGY_VERSION}>
        <p>Oito componentes de 1 a 10: <b>mercado</b> (volatilidade e queda máxima históricas, ou duration para renda fixa), <b>crédito</b> (tipo de emissor, rating, garantias FGC/FDIC), <b>liquidez</b> (prazo de resgate, carência), <b>cambial</b> (moeda vs. moeda-base), <b>concentração</b>, <b>contraparte</b> (custódia/plataforma), <b>regulatório</b> e <b>tecnológico/smart contract</b> (quando aplicável).</p>
        <p>A nota geral é a média ponderada dos componentes aplicáveis com piso de “elo mais fraco”: nunca inferior ao componente de mercado ou de crédito menos 1 (riscos de perda permanente) nem a qualquer outro componente menos 2. Assim, um risco severo (ex.: inadimplência de um token sem garantia) não é diluído. Faixas: 1–2 muito baixo, 3–4 baixo, 5–6 moderado, 7–8 alto, 9–10 muito alto.</p>
        <p>Volatilidade sozinha não define risco: CDBs, debêntures e tokens de recebíveis têm oscilação baixa, mas risco de perda permanente por crédito, refletido no componente de crédito.</p>
      </Section>

      <Section id="retorno" title="Retorno esperado e cenários" version={CMA_METHODOLOGY_VERSION}>
        <ul>
          <li><b>Renda fixa e tokenizados de crédito</b>: taxa contratual com o indexador atual (CDI, Selic, IPCA 12m como proxy, T-Bill) menos custos e perda esperada de crédito (probabilidade × severidade). Pessimista: perda de crédito em estresse (4×) e alta de 2 p.p. nos juros com venda antes do vencimento.</li>
          <li><b>Ações, ETFs, FIIs/REITs</b>: taxa livre de risco local + prêmio de risco por classe (premissas de mercado de capitais) − custos. Faixa: percentis 10 e 90 de um modelo lognormal com a volatilidade histórica do ativo (ou premissa da classe, sinalizada).</li>
          <li><b>Cripto</b>: o Atlas não assume prêmio de risco positivo; o cenário-base é igual à taxa livre de risco e a faixa reflete a volatilidade.</li>
          <li><b>Stablecoins</b>: retorno-base zero em dólar menos custos e perda esperada por perda de paridade.</li>
          <li><b>Câmbio</b>: conversão para a moeda-base pelo diferencial de juros (paridade coberta) e volatilidade cambial de 15% a.a.</li>
          <li><b>Probabilidade de perda</b>: probabilidade de retorno nominal negativo no horizonte sob o modelo lognormal — exibida apenas quando há histórico do próprio ativo; caso contrário, “dados insuficientes”. Para renda fixa mantida até o vencimento, é a probabilidade de inadimplência.</li>
        </ul>
        <p>Projeções não são dados históricos nem garantias. Retornos históricos de dados de demonstração são simulados.</p>
      </Section>

      <Section id="builder" title="Portfolio Builder" version={BUILDER_METHODOLOGY_VERSION}>
        <p>Modelos de alocação por bloco (liquidez, renda fixa, ações, imobiliário, cripto, tokenizados) para três estratégias, ajustados pelos limites do perfil, exclusões e liquidez mínima. Dentro de cada bloco, os ativos são escolhidos por retorno esperado ajustado ao risco, qualidade dos dados e diversificação, com teto de 25% por ativo (45% para soberanos) e pesos inversamente proporcionais ao risco.</p>
        <p>Métricas da carteira: retorno esperado ponderado, volatilidade com matriz de correlação (histórica quando há ≥120 retornos em comum; premissa por classe caso contrário), cenários, testes de estresse, liquidez, custos e concentração (HHI por emissor, setor, país e moeda). Se nenhuma alternativa compatível atingir a meta, isso é informado.</p>
        <p>Testes de estresse: {STRESS_SCENARIOS.map((s) => s.label).join("; ")}.</p>
      </Section>

      <Section id="monitor" title="Monitoramento e alertas" version={ALERT_RULES_VERSION}>
        <p>Execução diária após o fechamento (padrão 21:30 UTC) e sob demanda. Regras: variação de preço por classe, volatilidade recente vs. 1 ano, mudança de nota de risco, concentração, desvio da alocação-alvo, juros (CDI/T-Bill), câmbio, perda de paridade de stablecoins, eventos de crédito/regulatórios/liquidez/contraparte/cripto, queda desde o pico, risco acima do perfil e limite de cripto.</p>
        <p>Limites configuráveis, peso mínimo para alertar e janela de silêncio para repetições (só reemite se a severidade aumentar). O monitor distingue <b>dia sem negociação</b>, <b>dados desatualizados</b>, <b>sem dados</b> e <b>fonte indisponível</b>, e não tira conclusões de preço sem dados.</p>
        <p>Calendários de feriados de B3 e NYSE cobertos para 2024–2027; fora desse período apenas fins de semana são considerados.</p>
      </Section>

      <Section id="fontes" title="Fontes de dados">
        <ul>
          <li><b>Banco Central do Brasil (SGS)</b> — CDI, Selic, IPCA 12m, PTAX. Público, sem chave, com defasagem de publicação.</li>
          <li><b>U.S. Treasury</b> — curva diária de juros (T-Bill 3M, 10Y). Público.</li>
          <li><b>CoinGecko</b> — preços de cripto e stablecoins (agregados, não executáveis).</li>
          <li><b>Alpha Vantage</b> (EUA) e <b>brapi.dev</b> (B3) — opcionais, exigem chave; cotações de fim de dia.</li>
          <li><b>Demonstração</b> — séries simuladas determinísticas, sempre marcadas com o selo DEMO, nunca misturadas com séries reais.</li>
        </ul>
        <p>Nenhuma fonte pública é tratada como tempo real ou preço executável. Os dados cadastrais dos produtos (taxas, ratings, elegibilidade) são ilustrativos e devem ser confirmados na documentação oficial.</p>
      </Section>

      <Section id="regulatorio" title="Limites regulatórios e privacidade">
        <p>O Atlas não executa ordens, não custodia recursos e não solicita credenciais de corretoras. As análises são informativas. A disponibilização comercial de recomendações personalizadas exige avaliação jurídica sobre a estrutura do serviço e as autorizações aplicáveis (por exemplo, registro de analista/consultor junto à CVM no Brasil e de investment adviser nos EUA). Um aviso legal, isoladamente, não elimina essas obrigações.</p>
        <p>Dados pessoais são tratados conforme a LGPD: isolamento por usuário no banco (row-level security), exportação e exclusão de dados pelo próprio usuário e trilha de auditoria somente-inclusão.</p>
      </Section>
    </div>
  );
}
