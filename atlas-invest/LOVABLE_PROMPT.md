# Atlas Invest AI — prompts para o Lovable

O Lovable funciona melhor por etapas. Envie o **Prompt 1** ao criar o projeto e os demais **um de cada vez**, conferindo o preview entre eles. Cada prompt já traz as regras e números que o MVP em Next.js usa, para que o resultado tenha o mesmo comportamento.

Antes do Prompt 2, ative o **Lovable Cloud** (Supabase). Antes do Prompt 5, cadastre o segredo `ANTHROPIC_API_KEY` (opcional).

---

## Prompt 1 — Fundação, design e dados de demonstração

```
Crie o MVP de "Atlas Invest AI — Intelligent Investment Copilot", uma plataforma de ANÁLISE, RECOMENDAÇÃO e MONITORAMENTO de investimentos no Brasil e nos EUA, toda em português do Brasil.

Regras de produto que valem para todo o app:
- Nunca prometer rentabilidade. Retornos projetados são "cenários de modelo", nunca garantias nem dados históricos.
- Se a meta de rentabilidade do usuário não for compatível com o perfil de risco, dizer isso claramente. Nunca aumentar o risco para atingir a meta.
- O app NÃO executa ordens de compra/venda e não pede credenciais de corretoras.
- Quando faltar dado, mostrar "Dados insuficientes" em vez de inventar números.
- Dados simulados sempre exibem um selo roxo "DEMO" (ícone de frasco). Nunca misturar dados reais e simulados na mesma série.
- Todos os cálculos financeiros, de risco e de alertas ficam em funções TypeScript puras e determinísticas em src/domain/ (não no componente, não no LLM).

Stack: React + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + lucide-react. Nesta etapa use apenas dados locais (sem backend).

Design: visual de wealth management institucional, minimalista e responsivo (sem rolagem horizontal em 390px).
- Sidebar fixa azul-marinho escuro (hsl 224 50% 11%) com logo "A" em gradiente teal→azul, "Atlas Invest AI / Investment Copilot"; no celular vira menu hambúrguer.
- Cor de marca teal (hsl 172 70% 30%). Escala de risco: 1–2 verde, 3–4 verde-oliva, 5–6 âmbar, 7–8 laranja, 9–10 vermelho. Severidades: Informativo (azul), Atenção (âmbar), Crítico (vermelho).
- Banner roxo claro no topo das páginas internas: "Ambiente de demonstração. Valores marcados DEMO são simulados. Análises informativas — não são ordens de investimento."
- Cards com cantos arredondados (rounded-2xl), números com fonte tabular.

Navegação (sidebar): Dashboard, Descobrir, Portfolio Builder, Portfólios, Alertas (badge com nº de alertas abertos), Agente IA, Recomendações, Configurações. Páginas públicas: Landing (/), Login, Cadastro, Onboarding, Metodologia (/methodology).

Crie src/domain/catalog.ts com 37 ativos (todos com spec completa: id, símbolo, nome, classe, mercado BR/US/GLOBAL, moeda BRL/USD, emissor, setor, país, descrição, pricing "quoted" ou "accrual", yield, duration, liquidityDays (D+N), lockedUntilMaturity, minHorizonYears, feesAnnual, tributação, crédito {tipo, rating, pdAnnual, lgd}, contraparte {custódia, score 1–10}, regulatório {regulador, score, elegibilidade}, tecnologia (só cripto/tokenizados) {chain, auditado, score}, holdings, e parâmetros demo {start, mu, sigma, jumpProb, jumpSize, peg}). Valores ilustrativos:
- Tesouro BR (accrual, soberano, custódia 0,20% a.a., só residentes BR): Tesouro Selic 2029 (Selic+0,08%, liq D+1), Tesouro IPCA+ 2035 (IPCA+7,2%, duration 8,4, horizonte mín. 5 anos), Tesouro Prefixado 2029 (13,4%, duration 2,6).
- Renda fixa bancária BR (FGC até R$ 250 mil): CDB 100% CDI liquidez diária (AAA), CDB banco médio 115% CDI venc. 2028 (A-, só no vencimento), LCI 95% CDI (isenta IR PF, carência 12m), LCA 93% CDI (isenta).
- Crédito privado: Debênture incentivada infra IPCA+7,8% 2032 (AA, sem FGC, isenta, duration 4,8, D+10); LQD (ETF IG EUA, USD, duration 8,3).
- Fundos: Fundo DI (97% CDI, taxa 0,3%, D+0); Government Money Market Fund EUA (T-Bill −0,12%).
- Ações/ETFs BR (quoted): BOVA11, IVVB11 (S&P 500 em reais, país EUA), PETR4, ITUB4, WEGE3, VALE3. FIIs: HGLG11 (logística), KNCR11 (CRI/papel).
- EUA (quoted, USD): VOO, QQQ, MSFT, NVDA, TLT (Treasuries 20+, duration 16,5), T-Note 5Y, VNQ, O (Realty Income). Accrual: T-Bill 3M, CD 12 meses (FDIC, só residentes EUA).
- Tokenizados: Token de recebíveis CCB BR (prefixado 18,5%, sem FGC, PD 4%, plataforma score 7, só no vencimento); Fundo tokenizado de T-Bills (somente investidor qualificado); Ouro tokenizado.
- Cripto/stablecoins (GLOBAL, USD, D+0): BTC, ETH, SOL, USDC, USDT (paridade 1,00).

Crie src/domain/demo-market.ts: gerador DETERMINÍSTICO de preços demo (hash FNV-1a do "assetId|data" → PRNG mulberry32 → normal Box-Muller; retorno diário lognormal com mu/sigma anuais, saltos opcionais; stablecoins revertem à paridade). Gere ~3 anos de histórico até hoje em dias úteis (B3/NYSE com feriados 2024–2027; cripto todos os dias). Indicadores macro demo: CDI 14,9%, Selic 15%, IPCA 12m 4,8%, USD/BRL 5,42, T-Bill 3M 3,9%, Treasury 10Y 4,2%.

Nesta etapa entregue: layout completo, landing page (hero, 6 cards de recursos, aviso regulatório, botão "Explorar conta demo"), páginas de login/cadastro visuais, e a página de Metodologia com o texto das regras. As demais páginas podem mostrar o esqueleto; vamos preenchê-las nas próximas etapas.
```

---

## Prompt 2 — Banco, autenticação, perfil e motor de risco

```
Ative o backend (Lovable Cloud / Supabase) e implemente:

1) Autenticação com Supabase Auth (e-mail/senha). Cadastro exige checkbox de consentimento LGPD ("Li e aceito o tratamento dos meus dados para análise de investimentos e entendo que o Atlas não executa ordens nem garante retornos"). Proteja todas as rotas internas; sem perfil, redirecione para /onboarding.

2) Tabelas (com RLS habilitada e política "user_id = auth.uid()" para select/insert/update/delete em todas as tabelas do usuário):
profiles, investment_profiles (answers jsonb, derived jsonb, base_currency, methodology_version), user_preferences (notifications jsonb, thresholds jsonb), portfolios, positions (asset_id, quantity, avg_price, acquired_at, origin 'manual'|'imported', manual_value, notes), target_allocations, recommendations (kind, title, summary, body jsonb, confidence 'baixa'|'média'|'alta', confidence_score, methodology_versions jsonb, data_as_of, uses_demo_data, generator), recommendation_evidence (label, value jsonb, source, data_as_of, is_demo), monitoring_runs, monitoring_snapshots, portfolio_snapshots, alerts, notifications, audit_log.
Tabelas compartilhadas, somente leitura para usuários autenticados (escrita só por edge functions com service role): data_sources, assets (spec jsonb), asset_prices (asset_id, date, close, source_id, is_demo — PK asset_id+is_demo+date), macro_indicators (code, date, value, is_demo), market_events, risk_metrics.
audit_log: usuário só pode INSERT e SELECT dos próprios registros (sem update/delete). Trigger que impede inserir position/target_allocation em portfólio de outro usuário.
Crie uma edge function "seed-demo" que popula assets a partir do catálogo e gera os preços/macro demo (is_demo = true), idempotente.

3) Onboarding em 5 etapas com barra de progresso (botões de escolha em cards, não selects):
(1) país de residência BR/EUA/Outro, moeda-base BRL/USD, valor disponível; (2) objetivo (preservação, renda, crescimento, alto crescimento), meta anual com slider 1–100% + campo livre que aceita >100% (aviso âmbar se ≥30%), horizonte (<1, 1–3, 3–5, >5 anos); (3) tolerância a perdas com exemplo "se seus R$ X caíssem 20%…" (baixa/moderada/alta/muito alta) e liquidez (diária/mensal/anual/sem necessidade); (4) mercados BR/EUA e chips de classes para excluir, checkbox de investidor qualificado; (5) experiência em investimentos e em cripto; tela final mostra o perfil explicado.
ATENÇÃO aos inputs numéricos: use step="any" (não step=1000 com min=100, que invalida 50000).

4) src/domain/profile.ts (profile-v1.0). Nível 1 Conservador, 2 Moderado, 3 Arrojado, 4 Agressivo = MÍNIMO entre:
tolerância (baixa 1, moderada 2, alta 3, muito alta 4), horizonte (<1:1, 1–3:2, 3–5:3, >5:4), liquidez (diária 2, mensal 3, anual 4, nenhuma 4), objetivo (preservação 1, renda 2, crescimento 4, alto crescimento 4), experiência (nenhuma 2, básica 3, intermediária/avançada 4).
Derivados: risco máx. da carteira {1:3, 2:5, 3:6, 4:8}; queda tolerável {5%, 15%, 30%, 50%}; cripto máx. {0, 3%, 8%, 15%} (2% se sem experiência em cripto; 0 se excluída); tokenizados máx. {0, 3%, 7%, 10%}; liquidez mínima em até D+5 {diária 60%, mensal 35%, anual 15%, nenhuma 0}; horizonte em anos {0,5; 2; 4; 7}.
A explicação lista o fator determinante e SEMPRE diz: "Sua meta de X% ao ano não foi usada para aumentar o nível de risco."

5) src/domain/risk.ts (risk-v1.0). Oito componentes 1–10:
- mercado: ativos cotados → max(nota da volatilidade, nota do drawdown −1). Volatilidade: limites [1%,3%,6%,10%,15%,20%,30%,45%,70%] → notas 1..10. Drawdown: [1%,3%,7%,12%,20%,30%,42%,55%,70%]. Renda fixa accrual por duration (≥7:5, ≥4:4, ≥1,5:3, senão 1). Stablecoin 3. Sem histórico: cripto 9, ação 7, outros 6.
- crédito: soberano 2 (UST 1); bancário com FGC/FDIC min(rating,4); corporativo rating+1; carteira de fundo pelo rating; stablecoin 5–6; token/SPV 6–8 conforme PD; ações e cripto "não aplicável".
- liquidez: D≤1:1, ≤5:2, ≤15:4, ≤30:5, ≤90:6, ≤365:7, maior:9; só no vencimento 7–8.
- cambial: moeda-base 1; mesma moeda mas exposição a outro país 5; outra moeda 6.
- concentração: soberano 2; bancário com garantia 3; cripto 8; ≥300 ativos 2, ≥50: 3, ≥15: 4, >1: 5, emissor único 7.
- contraparte, regulatório: do cadastro. tecnológico/smart contract: só quando aplicável.
Nota geral = média ponderada dos aplicáveis (mercado .30, crédito .20, liquidez .15, cambial .08, concentração .07, contraparte .10, regulatório .05, tecnológico .05) com PISO: nunca abaixo de (mercado ou crédito − 1) nem de (qualquer outro componente − 2). Categorias: 1–2 muito baixo, 3–4 baixo, 5–6 moderado, 7–8 alto, 9–10 muito alto. Retorne explicação legível, até 3 fatores que mais contribuíram e limitações (dados demo, histórico < 250 obs., valor estimado pela curva, sem rating, dados cadastrais a confirmar).

Crie testes Vitest para profile.ts e risk.ts (ex.: meta alta não muda o nível; Tesouro Selic ≤ 3; BTC ≥ 8; token de recebíveis > CDB com FGC; piso do pior componente).
```

---

## Prompt 3 — Investment Discovery, detalhe do ativo e Portfolio Builder

```
Implemente a análise de ativos, a descoberta e o Portfolio Builder.

1) src/domain/finance.ts: retornos, volatilidade anualizada (log-retornos, 252 ou 365 para cripto), CAGR, drawdown máximo, VaR histórico, correlação de Pearson com alinhamento por data, CDF normal e inversa, percentil lognormal anualizado, probabilidade de perda lognormal, IR regressivo BR (22,5/20/17,5/15%), HHI, volatilidade de carteira com matriz de correlação.

2) src/domain/analytics.ts (atlas-cma-v1.0), para cada ativo, na moeda-base e horizonte do usuário:
- Histórico (só cotados com ≥60 obs.): retorno 12m, CAGR 3 anos, volatilidade, drawdown máx.
- Renda fixa/tokenizados accrual: taxa contratual com o indexador atual (% CDI, Selic+, IPCA12m+ como proxy, prefixado, T-Bill+) − custos − perda esperada (PD×LGD, ×0,2 se FGC). Pessimista: perda de crédito ×4 e +2 p.p. nos juros se vender antes do vencimento (duration). Otimista: queda de 1 p.p. nos juros.
- Cotados: taxa livre de risco local (CDI ou T-Bill) + prêmio (ações BR 5%, ações EUA 4,5%, imobiliário 3–3,5%, FII de papel 1,5%, crédito IG 1,2%, Treasuries 0,3–0,6%, ouro −1%, CRIPTO 0% — não assumir prêmio positivo, STABLECOIN 0 − custos − perda esperada de paridade) − custos. Cenários = percentis 10/50/90 lognormais com a volatilidade histórica (≥120 obs.) ou premissa da classe (sinalizada).
- Moeda diferente da base: deriva cambial = (1+rf_base)/(1+rf_ativo)−1 e vol cambial 15% (correlação −0,3 ações EUA, +0,3 ações BR, −0,1 cripto).
- Probabilidade de perda: só com histórico do próprio ativo; senão "Dados insuficientes". Renda fixa mantida até o vencimento = probabilidade de inadimplência no horizonte.
- Retorno após IR estimado só para regimes BR. Qualidade de dados 0–100 (−40 demo, −20 desatualizado, −15 histórico <1 ano, −10 vol por premissa, −10 valor estimado) → alta/média/baixa.

3) src/domain/discovery.ts: elegibilidade (residência BR/EUA, investidor qualificado, mercados e classes do perfil) e compatibilidade 0–100 → alta/média/baixa/incompatível (risco acima do limite do perfil, cripto sem espaço no perfil, ativo só no vencimento vs. liquidez diária, horizonte mínimo, meta atingida no cenário-base, pessimista acima da queda tolerável, qualidade dos dados). Gere uma justificativa em uma frase.

4) Página Descobrir: lista de cards (nome, classe, mercado/moeda, selo DEMO/Real, justificativa, base a.a. "≥ meta"/"< meta", faixa pessimista–otimista, prob. de perda, liquidez, nota de risco, compatibilidade, qualidade e fonte/data). Chips de classe, ordenação (compatibilidade, retorno, menor risco, liquidez, qualidade) e painel de filtros: mercado, moeda, retorno mín., risco máx., volatilidade máx., drawdown máx., prob. de perda máx., prazo de resgate máx., custos máx., qualidade mín., crédito/contraparte/smart contract máx., "somente elegíveis", "somente compatíveis", "compatível com meu horizonte". Botão "Comparar" (até 4) abre tabela lado a lado com todas as métricas e componentes de risco; se forem classes diferentes, mostrar aviso de que volatilidade de renda fixa, ações e cripto não medem o mesmo risco.

5) Página do ativo (/assets/:id): gráfico de preço (roxo e "Série SIMULADA" se demo) ou bloco de taxa contratual; cenários com barra pessimista–base–otimista, após IR, prob. de perda e nota; métricas históricas; risco por componente (barras coloridas) com fatores e limitações; compatibilidade (motivos ✓ e alertas ⚠); características, custos, tributação, crédito, custódia, regulação, elegibilidade, tecnologia; lista da metodologia do cenário; botão "Adicionar a um portfólio".

6) src/domain/portfolio.ts e builder.ts (builder-v1.0):
- Blocos e modelos: Conservadora {liquidez 45, renda fixa 40, ações 10, imobiliário 5, cripto 0, tokenizados 0}; Equilibrada {20, 33, 32, 10, 3, 2}; Agressiva {7, 15, 53, 10, 10, 5}. Aplicar limites de cripto/tokenizados do perfil DEPOIS da renormalização (excesso vai para renda fixa), liquidez mínima, exclusões e só ativos elegíveis.
- Escolha dentro do bloco por retorno ajustado ao risco + qualidade + diversificação, com viés doméstico: penalizar 5 p.p. ativos em moeda diferente da base nos blocos de liquidez e renda fixa. Iniciantes preferem ETFs a ações individuais. Ações divididas entre BR e EUA quando ambos permitidos. Pesos inversos ao risco; teto 25% por ativo (45% soberano); a redistribuição do excesso não pode ir para cripto/tokenizados.
- Métricas da carteira: retorno esperado, volatilidade com correlação (histórica com ≥120 retornos em comum na mesma moeda, senão premissa por classe), faixa p10/p90, prob. de perda, risco consolidado (8 componentes: mercado pela vol da carteira, cambial pela exposição <5%:1, <15%:2, <30%:4, <50%:6, senão 8; concentração pelo HHI de emissores), liquidez (D+1, D+5, D+30, >30), custos, concentração por emissor/setor/país/moeda, fatores de risco.
- 5 testes de estresse com choques e câmbio (USD vs BRL): Crise doméstica BR (ações BR −35%, FII −20%, renda fixa longa BR −12%, dólar +30%…), Crise financeira global (ações −45%, REITs −55%, cripto −70%, Treasuries longos +12%, dólar +35%), Inverno cripto (cripto −75%, stablecoin −8%, tokenizados −20%), Choque de juros EUA (bonds EUA −15%, ações EUA −18%, dólar +10%), Inflação persistente BR.
- Compatível se risco ≤ limite, pior estresse ≤ 1,5× queda tolerável e liquidez ≥ mínima. Sugerida = compatível cujo estresse cabe na queda tolerável, depois maior retorno. Viabilidade da meta: "compatível", "desafiadora" (≥85% da meta) ou "incompatível" com a frase "A meta de X% a.a. não é compatível com o seu perfil de risco. O maior retorno esperado entre as alternativas compatíveis é Y% a.a. Não vamos sugerir ativos mais arriscados apenas para atingir a meta."

7) Página Portfolio Builder: campo de valor + "Gerar três alternativas" → banner de viabilidade (verde/âmbar/vermelho) com confiança e selo demo; 3 colunas (badge "Sugerida", "Compatível"/"Fora do perfil", retorno com faixa, risco, volatilidade, prob. de perda, pior estresse, liquidez D+5, exposição cambial, custo, maior emissor, alocação com barras e justificativa por ativo); tabelas de estresse e distribuição por classe/moeda comparando as 3; mapa de calor de correlação; fatores de risco. Cada geração é salva em recommendations (kind portfolio_proposal) com evidências (perfil, macro, cada ativo usado com fonte/data/flag demo). Botão "Salvar como portfólio" abre diálogo com nome e opção "Criar posições planejadas com o valor informado"; arredonde os pesos para baixo e aceite soma até 100,5%.

Adicione testes Vitest: pesos somam 100%, tetos e limites de cripto respeitados, exclusões, conservadora menos arriscada que agressiva, estresse cambial, viabilidade da meta.
```

---

## Prompt 4 — Portfólios, dashboard e monitoramento diário com alertas

```
Implemente portfólios, dashboard e o Daily Portfolio Monitor.

1) Portfólios: lista com valor, retorno esperado e risco; criar vazio, editar nome/descrição, duplicar, arquivar. Detalhe: KPIs, faixa de resultados, componentes de risco, rosca por classe, tabela de posições (ativo, quantidade, preço médio, preço atual, valor na moeda-base, resultado R$ e %, "Manual"/"Importado", avaliação "Cotação real"/"Cotação demo"/"Estimado (curva)"/"Valor informado", editar/remover), alocação atual vs. alvo com desvio, liquidez, concentração (HHI), estresse em % e R$, correlação, alertas do portfólio. Formulários: adicionar posição (ativo, quantidade, preço médio com atalho "atual" ou "1" para renda fixa, data não futura, valor informado opcional, observações), importar CSV (ativo,quantidade,preco_medio,data_aquisicao; separador vírgula, ";" ou tab — com ";" ou tab aceite vírgula decimal; erros por linha), editor de alocação-alvo (soma ≤100%), "Gerar posições planejadas" a partir do alvo.
Avaliação: cotados = quantidade × último preço; accrual = custo × (1+taxa contratual−custos)^anos (Estimado); valor informado prevalece; conversão pelo USD/BRL atual. Todas as alterações gravam audit_log.

2) Dashboard: seletor de portfólios (chips), patrimônio total monitorado, valor do portfólio com "X% demo", variação 1 dia/30 dias/12 meses (rotular "Simulada*"), medidor de risco com marcação do limite do perfil, gráfico de rentabilidade acumulada base 100 vs. CDI (ou T-Bill), Ibovespa (BOVA11) e S&P 500 (VOO) com nota "Desempenho simulado da composição atual (quantidades e câmbio constantes); não é rentabilidade realizada", indicadores-chave (retorno esperado com faixa, exposição cambial, liquidez até D+5 vs. mínimo, volatilidade, custo), "Próxima revisão recomendada" (hoje se houver alerta crítico; senão até 30 dias ou 90 dias após atualizar o perfil) e último monitoramento, roscas por classe/país/moeda, "Origem dos valores" (manual vs. importado; real vs. demo vs. estimado), alertas que exigem atenção e principais oportunidades. Probabilidades muito pequenas aparecem como "<0,1%". Botão "Executar monitoramento".

3) Monitor (edge function "run-monitoring"): para cada portfólio do usuário, compara com o snapshot da execução anterior (ou fechamento anterior na primeira vez) e aplica as regras puras de src/domain/alerts.ts (alerts-v1.0), com limites configuráveis:
- variação de preço: ações/ETFs/FIIs 5%, cripto 10%, renda fixa 1,5%; atenção ≥ limite, crítico ≥ 2× limite ou impacto ≥3% da carteira; posições < 2% viram informativo.
- stablecoin fora da paridade ≥0,5% (crítico ≥2%); volatilidade 20d ≥1,6× a de 1 ano; nota de risco +2 ou mais; peso > 25% por ativo; desvio do alvo ≥5 p.p.; CDI ou T-Bill ±0,25 p.p. (se houver renda fixa); USD/BRL ±3% (se exposição ≥10%); eventos de crédito/regulatório/liquidez/contraparte/fundamentos/cripto dos ativos da carteira; risco da carteira acima do perfil; queda desde o pico ≥75% da queda tolerável; cripto acima do limite.
- Dados: distinguir "Sem pregão hoje", "Desatualizado", "Sem dados", "Fonte indisponível" — sem dados, gerar só alerta informativo de disponibilidade e nenhuma conclusão de preço.
- Cada alerta: o que mudou, por que importa, ativos e objetivos afetados, impacto (% e R$), urgência, ação sugerida, evidências (dado, valor, fonte, data, flag demo), data/hora da análise.
- Deduplicação: mesma impressão digital dentro da janela de silêncio (24h) só incrementa "detectado N×", a menos que a severidade aumente.
- Grave monitoring_runs (gatilho manual/agendado, status por mercado, status dos dados, fontes, resumo), snapshots, alerts e notifications. Agende execução diária às 21:30 UTC com pg_cron chamando a edge function para todos os usuários com perfil.

4) Central de alertas com abas: Alertas (filtros por severidade e status; card com borda colorida, selo DEMO, "N× detectado", impacto e ação), Notificações (canal, status entregue/não configurado/falhou, lida/não lida, "Marcar como lidas"), Execuções do monitor (status, gatilho, mercados com/sem pregão, status dos dados, fontes). Detalhe do alerta: seções O que mudou / Por que isso importa / Impacto / Ação sugerida ("Sugestão analítica; o Atlas não executa ordens"), afetados, urgência, tabela de evidências e botões Reconhecer / Resolver / Reabrir.

5) Configurações > "Laboratório de demonstração" (edge function "apply-demo-scenario", só altera dados is_demo): Queda forte em cripto (BTC −18%, ETH −24%, SOL −30%), Perda de paridade de stablecoin (USDT 0,965 + evento crítico), Estresse doméstico BR (Ibovespa −7%, dólar +6%, CDI +0,5 p.p.), Evento de crédito em banco médio (rebaixamento do emissor do CDB 115% CDI), Alta de juros EUA, Problema em plataforma de tokenização. Depois de aplicar, mostrar "Execute o monitoramento para gerar alertas".

Testes Vitest das regras: oscilação irrelevante não alerta, severidades, limites por classe, dados indisponíveis, depeg, deduplicação e calendário.
```

---

## Prompt 5 — Agente de IA, histórico de recomendações e dados reais

```
Implemente o agente de IA, o histórico de recomendações e a camada de dados de mercado.

1) Edge function "agent-report" (AIInvestmentAgent). O modelo NUNCA calcula números: ele chama ferramentas determinísticas e explica.
Ferramentas: get_profile, list_portfolios, get_portfolio_analytics(portfolio_id), get_review_signals(portfolio_id) (postura determinística: "reduzir exposição" se risco > limite ou pior estresse > 1,5× queda tolerável; "revisar" se houver alerta crítico aberto ou liquidez abaixo do mínimo; "rebalancear" se desvio ≥5 p.p.; senão "manter", com motivos), search_opportunities(filtros), compare_assets(ids), get_recent_alerts.
Com o segredo ANTHROPIC_API_KEY, use a API da Anthropic (modelo claude-opus-5-5, loop de tool use até 8 turnos). System prompt: todo número deve vir das ferramentas; projeções não são garantias; avisar dados demo/desatualizados; dizer claramente se a meta é incompatível; não sugerir ordens; não comparar métricas incompatíveis sem explicar; indicar data dos dados e confiança; formato Markdown com Resumo, Análise, Riscos principais, Recomendação, Limitações dos dados; terminar com "Análise informativa; não constitui ordem de investimento".
Sem a chave, use um "analista por regras" que chama as mesmas ferramentas e preenche esse modelo de texto, informando que perguntas livres exigem a chave.
Salve em recommendations (kind agent_report) com cada chamada de ferramenta como evidência, gerador ("rules" ou "anthropic:<modelo>"), data dos dados e confiança (≈55 com dados demo, ≈82 com dados reais, −10 por ferramenta com erro).

2) Página Agente IA: seletor de portfólio, campo de pergunta, botões "Gerar relatório de revisão" e "Perguntar", sugestões de perguntas, relatório renderizado em Markdown com confiança, selo demo e link para evidências, lista de relatórios anteriores.

3) Página Recomendações: histórico somente leitura (tipo, título, confiança, selo demo, data, gerador, resumo). Detalhe: justificativa, versões das metodologias (profile-v1.0, risk-v1.0, atlas-cma-v1.0, builder-v1.0, alerts-v1.0), ferramentas usadas e evidências expansíveis em JSON com fonte, data e selo demo.

4) Edge function "refresh-market-data" (provedores atrás de uma interface comum; cache de 60 min; cada provedor grava status ok/erro/último sucesso/último erro em data_sources; dados reais com is_demo=false; nunca inventar valores — em falha, manter os dados demo sinalizados):
- Banco Central SGS (sem chave): séries 12 (CDI diário % → anual com 252 d.u.), 432 (Selic), 13522 (IPCA 12m), 1 (PTAX). URL https://api.bcb.gov.br/dados/serie/bcdata.sgs.{n}/dados/ultimos/30?formato=json (datas dd/mm/aaaa).
- U.S. Treasury Daily Par Yield Curve (XML, 3M e 10Y).
- CoinGecko market_chart 365 dias para BTC, ETH, SOL, USDC, USDT (chave opcional COINGECKO_API_KEY).
- Alpha Vantage (ALPHAVANTAGE_API_KEY) para ativos dos EUA e brapi.dev (BRAPI_TOKEN) para a B3 — opcionais.
Uma série usa só dados reais se existirem; senão só demo. Indicadores macro reais valem se tiverem até 10 dias. Agende com pg_cron antes do monitor diário.

5) Configurações: perfil (resumo + "Refazer perfil"), notificações (in-app; e-mail via Resend com segredo RESEND_API_KEY — sem ele, status "não configurado"; webhook HTTPS JSON; severidade mínima por canal), limites de alerta editáveis, tabela de fontes de dados com status e botão "Atualizar dados agora", indicadores macro com selo Real/DEMO, laboratório de demonstração, privacidade LGPD ("Exportar meus dados" em JSON via edge function; "Excluir minha conta" digitando EXCLUIR), histórico de auditoria.
```

---

## Prompt 6 — Conta demo e revisão final

```
Finalize o MVP:

1) Conta demo: edge function idempotente que cria o usuário demo@atlas.local (senha atlas-demo-2026) com perfil Moderado (BR, BRL, R$ 350.000, crescimento, meta 16%, 3–5 anos, tolerância moderada, liquidez mensal, BR+EUA, experiência intermediária, cripto básica), um portfólio "Carteira principal (demo)" com alvo (Tesouro Selic 15%, IPCA+ 2035 12%, CDB 115% CDI 8%, LCI 8%, BOVA11 12%, ITUB4 5%, WEGE3 5%, HGLG11 7%, VOO 15%, BTC 3%, USDT 2%, token de recebíveis 3%), posições dimensionadas pelos preços demo atuais com pequeno desvio do alvo, e uma execução inicial do monitor para servir de base. Botão "Explorar conta demo" na landing e no login. A conta demo não pode ser excluída.

2) Revise o fluxo completo e corrija o que falhar: cadastro → onboarding → Descobrir e comparar 3 ativos → Portfolio Builder → salvar portfólio → adicionar posição → aplicar "Queda forte em cripto" → executar monitoramento → abrir o alerta e ver evidências → gerar relatório do agente → exportar dados.

3) Verifique: nenhum botão sem ação, nenhuma tela vazia sem estado vazio explicativo, selo DEMO em todo valor simulado, nada com rolagem horizontal em 390px, nenhum aviso de hidratação, nenhuma chave de API no frontend, e que um usuário não consegue ler nem alterar dados de outro (teste as políticas RLS com dois usuários).

4) Página Metodologia completa: perfil, motor de risco (componentes, pesos e piso), retorno esperado e cenários, builder e estresses, monitoramento e alertas, fontes de dados (nenhuma tratada como tempo real), limites regulatórios (análise informativa; recomendação personalizada comercial exige avaliação jurídica e autorizações — CVM no Brasil, SEC/estados nos EUA; um disclaimer sozinho não basta) e LGPD.
```

---

## Prompt 7 — UX de app de banco brasileiro (navegação, linguagem e formato)

```
Vamos deixar o Atlas com cara de app de banco brasileiro (referências: Nubank, Inter, Itaú, PicPay), para quem nunca usou ferramenta de investimento profissional. NÃO altere nenhum cálculo de src/domain/ nem as regras do produto; mude só apresentação, textos e navegação. Os detalhes técnicos continuam acessíveis.

1) Navegação mobile-first
- No celular, troque o menu lateral por uma barra inferior fixa com 5 abas e ícones: Início, Investir, Minha carteira, Avisos (com bolinha vermelha e número), Perfil. No desktop mantenha a sidebar com os mesmos 5 itens; Recomendações, Agente IA e Configurações ficam dentro de "Perfil" e "Investir".
- Uma ação principal por tela, com botão grande e fixo no rodapé no celular (estilo fluxo do Pix). Ações secundárias como links.

2) Tela Início (substitui o Dashboard)
- Topo: "Olá, {primeiro nome}" e o patrimônio total em fonte grande com ícone de olho para ocultar/mostrar valores (troca todos os valores do app por "R$ ••••"); preferência salva no navegador. Abaixo: "Rendeu R$ X nos últimos 30 dias (simulado)" em verde/vermelho.
- Linha de atalhos em ícones redondos: Simular, Montar carteira, Adicionar investimento, Ver avisos.
- Se houver aviso crítico aberto, um card vermelho no topo, antes de tudo.
- Cards em sequência: "Suas caixinhas" (portfólios com barra de progresso), "Sua carteira vs. CDI e poupança" (gráfico simples só com essas 3 linhas; Ibovespa e S&P 500 em "Mais comparações"), "Avisos recentes", "Sugestões que combinam com você".
- Indicadores técnicos (volatilidade, HHI, componentes de risco, correlação) saem do Início e vão para "Ver análise completa" dentro de cada carteira.

3) Falar em reais, não só em porcentagem
- Em todo lugar que mostrar retorno esperado, mostrar também o valor: "R$ 10.000 podem virar cerca de R$ 18.500 em 4 anos" (calcule com o cenário-base e o horizonte do usuário; use o valor investido real quando houver).
- Substitua a barra pessimista/base/otimista por 3 cartões lado a lado: "Se for mal", "O mais provável", "Se for bem", cada um com o valor final em R$ e o % a.a. pequeno embaixo. Rodapé: "Estimativas, não garantias."
- Risco em dinheiro: "Num ano muito ruim, seus R$ 50.000 poderiam cair para cerca de R$ 42.800" (use o pior teste de estresse).

4) CDI e poupança como régua
- Em cada ativo e carteira: "≈ 112% do CDI" e "2,3× a poupança" (poupança = 70% da Selic quando Selic > 8,5% a.a.; senão 0,5% ao mês + TR, considere TR = 0). Calcule com o cenário-base.
- Mostre rentabilidade LÍQUIDA de IR por padrão quando houver estimativa, com o texto "líquido de IR"; a bruta aparece ao tocar.

5) Rótulos e selos em linguagem simples (componente reutilizável de "chips"):
- Liquidez: D+0 → "Resgate na hora"; D+1 → "Resgate no dia seguinte"; D+2 a D+5 → "Resgate em até N dias úteis"; só no vencimento → "Dinheiro preso até {mês/ano}".
- Garantia: crédito bancário com FGC → selo verde "Protegido pelo FGC até R$ 250 mil"; FDIC → "Protegido pelo FDIC até US$ 250 mil"; sem garantia → selo cinza "Sem garantia do FGC".
- Imposto: isento PF → "Sem imposto de renda"; regressivo → "IR de 15% a 22,5% sobre o lucro".
- Risco: termômetro horizontal de 5 segmentos (Muito baixo → Muito alto) com a nota 1–10 pequena ao lado; no perfil, mostrar onde o usuário está na mesma régua.
- Compatibilidade: "alta" → "Combina com você"; "média" → "Combina em parte"; "baixa" → "Pouco indicado para você"; "incompatível" → "Não combina com seu perfil" (com o motivo em uma linha).
- Troque o selo "DEMO" por "Simulação" (mesmo roxo e ícone), com tooltip "Valores de exemplo, não são preços reais". Banner: "Você está vendo valores de simulação."

6) Jargão escondido, não removido
- Ícone "?" ao lado de termos técnicos (CDI, Selic, IPCA, FGC, duration, volatilidade, drawdown, stablecoin, tokenizado, liquidez, marcação a mercado) que abre um bottom sheet com explicação de 2 linhas e um exemplo. Centralize os textos num glossário (src/content/glossary.ts) também acessível em Perfil > Glossário.
- Seções técnicas (componentes de risco, correlação, HHI, metodologia, evidências JSON) ficam em accordions fechados chamados "Ver análise completa" / "Ver detalhes técnicos".

7) Formato brasileiro em todo o app
- Moeda sempre "R$ 1.234,56" e "US$ 1,234.56" só para valores em dólar; percentuais com vírgula ("16,7%"), inclusive nos textos de alertas e relatórios do agente (crie uma função de formatação única e use em todo lugar, inclusive nas edge functions).
- Datas "18 de out." / "18 de out. de 2026"; horas "às 14h30"; agrupamentos "Hoje", "Ontem", "Esta semana".
- Campos de valor com máscara de reais e botões de atalho: R$ 1 mil, R$ 10 mil, R$ 50 mil, R$ 100 mil+.

8) Confiança e acessibilidade
- Faixa discreta e fixa em Início e Investir: "O Atlas nunca movimenta seu dinheiro e nunca pede a senha do seu banco."
- Respeitar o tamanho de fonte do sistema (use rem), contraste AA, alvos de toque ≥ 44px, modo escuro seguindo o sistema com opção em Perfil.
- No login: "Lembrar meu e-mail" e mostrar/ocultar senha.

Ao final, confira em 390px e 1280px que todas as telas seguem esse padrão e que nenhum número do app mudou (só a forma de mostrar).
```

---

## Prompt 8 — Caixinhas, simulador, onboarding conversacional e avisos humanos

```
Continue a adaptação para o público de apps de banco brasileiros. Não altere os cálculos de src/domain/; reutilize-os.

1) Caixinhas (objetivos)
- Portfólios passam a se chamar "caixinhas" na interface. Campos novos em portfolios: emoji, goal_amount (meta em R$), goal_date, goal_type ('reserva_emergencia' | 'viagem' | 'casa' | 'aposentadoria' | 'educacao' | 'outro').
- Card de caixinha: emoji, nome, valor atual / meta, barra de progresso, "faltam R$ X até {mês/ano}" e "guardando R$ Y por mês você chega lá no cenário mais provável" (calcule com o retorno esperado da carteira).
- Caixinha "Reserva de emergência" (atalho na criação): sugere 6× gasto mensal informado, força liquidez "Resgate na hora/dia seguinte", risco máximo 2/10 e só renda fixa com FGC ou Tesouro Selic, independentemente do perfil geral.
- Cada caixinha pode ter horizonte e tolerância próprios (usa deriveProfile com as respostas do perfil sobrescritas pelo objetivo).

2) Fluxo "Montar carteira" (substitui a entrada do Portfolio Builder)
Passos em telas cheias, uma pergunta por tela, botão fixo no rodapé:
 (1) "Para que é esse dinheiro?" — cards com emoji dos tipos de objetivo;
 (2) "Quanto você tem para começar?" e "Consegue guardar quanto por mês?" — campos com máscara e atalhos;
 (3) "Para quando?" — chips (até 1 ano, 1–3, 3–5, mais de 5) ou data;
 (4) resultado: as 3 alternativas como cards deslizáveis (carrossel no celular) com "Combina com você" no topo; cada card mostra os 3 cenários em R$, "≈ X% do CDI", "Num ano ruim pode cair até R$ Y", "Resgate: N% na hora" e a lista de investimentos com chips; botão "Criar caixinha com essa carteira". O detalhamento atual (estresse, correlação, custos) fica em "Ver análise completa".
Se a meta for incompatível, mostrar um card amarelo amigável: "Com seu perfil, o mais provável é chegar a R$ X, não R$ Y. Para chegar à meta você pode aumentar o valor mensal para R$ Z ou o prazo para N anos." (calcule Z e N pelo retorno esperado da alternativa compatível). Nunca sugerir aumentar o risco.

3) Simulador (aba Investir e também na landing, antes do cadastro)
- Sliders: "Quanto você tem hoje", "Quanto pode guardar por mês", "Por quanto tempo" (1 a 30 anos).
- Resultado em R$ comparando: Poupança, CDB 100% do CDI (líquido de IR), Tesouro IPCA+ e "Carteira sugerida para você" (se logado, usa a proposta compatível; se não, mostra a Equilibrada para perfil Moderado). Gráfico de linhas simples com valores em R$ e uma faixa sombreada entre pessimista e otimista para a carteira.
- Texto: "Simulação com taxas atuais; não é garantia." e botão "Quero montar essa carteira" (leva ao cadastro ou ao fluxo de montar carteira).

4) Onboarding conversacional
- Uma pergunta por tela, com tom de conversa e exemplos em reais do próprio valor informado. Ex.: "Imagina que seus R$ 50.000 viraram R$ 40.000 em 3 meses. O que você faria?" → "Resgataria tudo" (baixa), "Ficaria preocupado, mas esperaria" (moderada), "Esperaria com tranquilidade" (alta), "Aproveitaria para investir mais" (muito alta).
- Mercados e classes viram perguntas simples: "Quer investir também nos EUA?" (sim/não/não sei → BR+EUA com limite baixo) e "Topa ter uma parte pequena em cripto?" (sim/não/não sei → excluir cripto se não).
- Resultado num cartão grande "Você é Moderado" com 3 frases curtas, o termômetro de risco, "O que isso significa para você" (queda máxima que você disse aceitar, em R$) e "Por que?" expansível com a explicação completa atual. Botão "Montar minha primeira caixinha".

5) Avisos com tom humano
- Reescreva o título e o resumo de cada regra de alerta (mantendo as evidências e campos atuais) no formato:
  Título curto com emoji: "📉 Seu Bitcoin caiu 18% hoje".
  Linha 1, impacto em R$: "Na sua carteira isso é −R$ 79 (0,16% do total)."
  Linha 2, contexto: "Quedas assim são comuns em cripto. Sua carteira continua dentro do seu perfil." (varie por regra e severidade; para crítico: "Vale olhar com atenção hoje.")
  Botões: "Entender o que aconteceu" (abre o detalhe atual) e "Ver minha caixinha".
- Exemplos por regra: depeg → "⚠️ O USDT perdeu a paridade com o dólar"; evento de crédito → "🏦 O banco do seu CDB foi rebaixado"; desvio → "🔄 Sua carteira saiu do plano"; câmbio → "💵 O dólar subiu 6% e sua carteira sentiu"; juros → "📈 O CDI subiu: seus pós-fixados vão render mais".
- Aba Avisos em formato de extrato agrupado por "Hoje", "Ontem", "Esta semana", "Anteriores", com ícone de severidade e valor em R$ à direita.
- Em Perfil > Notificações, adicionar o canal "WhatsApp (em breve)" desabilitado, ao lado de e-mail e webhook, e "Resumo diário às 19h" (toggle).

6) Agente IA como "Assistente"
- Renomeie para "Assistente Atlas", com interface de chat (balões), sugestões de perguntas em chips ("Minha meta é realista?", "Estou correndo muito risco?", "O que fazer com minha reserva?") e respostas curtas primeiro, com "Ver relatório completo" abrindo o relatório atual com evidências.
- Ajuste o system prompt para responder em linguagem simples, sempre em reais e comparando com CDI/poupança, mantendo todas as regras atuais (números só das ferramentas, sem garantias, sem ordens).

Revise o fluxo completo no celular: simulador na landing → cadastro → onboarding conversacional → montar caixinha "Reserva de emergência" → montar caixinha "Aposentadoria" → aplicar cenário de simulação → ver aviso humano → perguntar ao Assistente.
```
