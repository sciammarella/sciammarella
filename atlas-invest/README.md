# Atlas Invest AI — Intelligent Investment Copilot (MVP)

Plataforma de **análise, recomendação e monitoramento** de investimentos no Brasil e nos EUA: renda fixa, Tesouro, ações, ETFs, FIIs/REITs, Treasuries, fundos, cripto, stablecoins e ativos tokenizados (RWA).

O usuário parte de uma meta de rentabilidade (1% a 100%+) e o sistema mostra o que é compatível com o seu perfil — e diz claramente quando a meta **não** é. O MVP **não executa ordens**, não custodia recursos e não pede credenciais de corretoras.

> **Status:** MVP funcional de ponta a ponta. Sem rede externa, roda inteiramente com **dados de demonstração identificados com o selo DEMO**. As integrações reais (BCB, Tesouro dos EUA, CoinGecko, Alpha Vantage, brapi) estão implementadas e testadas com amostras de resposta, mas **não foram validadas contra os endpoints reais** neste ambiente (o acesso de saída estava bloqueado). Veja [Integrações](#integrações).

---

## Início rápido

Requisitos: Node.js 20+ (testado com 22). Nenhum banco externo é necessário.

```bash
cd atlas-invest
npm install
cp .env.example .env.local      # opcional — tudo tem padrão
npm run dev                     # http://localhost:3000
```

Na primeira requisição o app aplica as migrações, sincroniza o catálogo de ativos, gera ~3 anos de séries de demonstração e cria a **conta demo** com uma carteira fictícia já monitorada:

- e-mail `demo@atlas.local` · senha `atlas-demo-2026` (ou o botão **“Explorar conta demo”** na landing page)

Produção local:

```bash
npm run build && npm start
```

### Roteiro de demonstração (≈5 min)

1. **Criar conta** → **onboarding** (10 perguntas em 5 etapas) → perfil explicável.
   Experimente uma meta de 40% a.a. com tolerância moderada: o perfil não muda por causa da meta.
2. **Descobrir** → filtre (retorno, volatilidade, drawdown, prob. de perda, liquidez, custos, qualidade dos dados, crédito, contraparte, smart contract) e selecione 3–4 ativos para **comparar lado a lado**.
3. **Detalhe do ativo** → cenários pessimista/base/otimista, risco por componente, metodologia, fonte e data dos dados.
4. **Portfolio Builder** → gere as três alternativas (conservadora, equilibrada, agressiva), veja a viabilidade da meta, estresse, correlação, custos e liquidez → **Salvar como portfólio**.
5. **Portfólio** → adicione posições manualmente, importe CSV, edite a alocação-alvo.
6. **Configurações › Laboratório de demonstração** → aplique “Queda forte em cripto” ou “Evento de crédito”.
7. **Alertas** → **Executar monitoramento agora** → abra o alerta e veja o que mudou, por que importa, impacto, ação sugerida e evidências.
8. **Agente IA** → relatório de revisão com postura (manter/rebalancear/revisar/reduzir) e evidências em **Recomendações**.

---

## Arquitetura

```
Next.js 16 (App Router, React 19, TypeScript, Tailwind + componentes estilo shadcn/ui, Recharts)
│
├── src/app/                 Páginas (server components) + server actions (src/app/actions.ts) + rotas de API
├── src/domain/              Núcleo DETERMINÍSTICO e puro (sem I/O) — testado unitariamente
│   ├── finance.ts           retornos, volatilidade, drawdown, VaR, correlação, normal/lognormal, IR regressivo
│   ├── analytics.ts         métricas históricas, retorno esperado e cenários (atlas-cma-v1.0), qualidade de dados
│   ├── risk.ts              Risk Intelligence Engine (risk-v1.0) — 8 componentes + piso de “elo mais fraco”
│   ├── profile.ts           perfil explicável (profile-v1.0)
│   ├── discovery.ts         elegibilidade e compatibilidade
│   ├── portfolio.ts         alocação, correlação, estresse, liquidez, custos, concentração
│   ├── builder.ts           3 propostas + viabilidade da meta (builder-v1.0)
│   ├── alerts.ts            regras de alerta + deduplicação (alerts-v1.0)
│   ├── calendar.ts          calendários B3/NYSE, frescor dos dados
│   ├── valuation.ts         avaliação de posições, histórico simulado
│   ├── catalog.ts           universo inicial (37 ativos, BR/EUA/global)
│   └── demo-market.ts       gerador determinístico de dados DEMO + cenários do laboratório
├── src/server/
│   ├── db/                  PGlite (Postgres embutido) ou PostgreSQL; withUser() aplica RLS por transação
│   ├── providers/           camada de provedores de dados (BCB, Treasury, CoinGecko, Alpha Vantage, brapi)
│   ├── ai/                  AIInvestmentAgent: ferramentas determinísticas + provedor Claude / analista por regras
│   ├── services/            UserProfileService, MarketDataService, InvestmentDiscoveryService (+ RiskEngine),
│   │                        PortfolioService, MonitoringService, NotificationService, AuditLogService,
│   │                        recomendações e autenticação
│   ├── scheduler.ts         agendador diário em processo (instrumentation.ts)
│   └── bootstrap.ts         catálogo, dados demo e conta demo
├── db/migrations/           SQL (schema, grants, row-level security, triggers)
├── scripts/                 migrate, seed, monitor (CLI)
└── tests/                   Vitest — cálculos, risco, perfil, builder, alertas, parsers, isolamento (RLS)
```

**Princípios aplicados**

- **Cálculos determinísticos.** Retornos, risco, cenários, estresse e regras de alerta são funções puras e versionadas. O LLM só orquestra ferramentas e redige; não estima números.
- **Evidência em tudo.** Cada recomendação grava evidências (dados usados, fonte, data, flag demo), versões das metodologias, data dos dados, gerador (regras ou modelo) e grau de confiança. Alertas guardam evidências e horário da análise.
- **Dados reais × demo nunca se misturam.** Cada observação tem `is_demo`; uma série usa apenas dados reais ou apenas demo. A UI exibe o selo **DEMO** em valores, ativos, alertas, recomendações e no banner global.
- **Isolamento por usuário no banco.** Toda leitura/escrita de dados do usuário roda em transação com `SET LOCAL ROLE atlas_app` + `app.user_id`; políticas RLS restringem cada tabela ao dono. O papel da aplicação não lê `sessions` e não pode alterar/excluir o `audit_log`. Triggers impedem anexar posições a portfólios de outro usuário.
- **Sem chaves no frontend.** Chaves só em variáveis de ambiente do servidor; as páginas são server components e as mutações são server actions.

### Modelo de dados

`users`, `sessions`, `investment_profiles`, `user_preferences`, `data_sources`, `assets`, `asset_prices`, `macro_indicators`, `market_events`, `risk_metrics`, `portfolios`, `positions`, `target_allocations`, `recommendations`, `recommendation_evidence`, `monitoring_runs`, `monitoring_snapshots`, `portfolio_snapshots`, `alerts`, `notifications`, `audit_log`, `scheduler_state` — ver `db/migrations/001_init.sql`.

### Dependências externas

| Dependência | Uso | Obrigatória? |
|---|---|---|
| PostgreSQL 14+ / Supabase | Banco em produção | Não — sem `DATABASE_URL` usa PGlite em `./.data/pglite` |
| Anthropic API (Claude) | Narrativa do agente | Não — sem chave usa o analista por regras |
| Banco Central (SGS), U.S. Treasury, CoinGecko | Macro e cripto reais | Não — fallback para demo, sinalizado |
| Alpha Vantage / brapi.dev | Cotações EUA / B3 | Não — exigem chave |
| Resend | E-mail de alertas | Não — sem chave, notificação fica “não configurada” |

---

## Configuração (`.env.example`)

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | vazio | Postgres/Supabase. Vazio = PGlite embutido |
| `PGLITE_DIR` | `./.data/pglite` | Diretório do PGlite |
| `ANTHROPIC_API_KEY` | vazio | Habilita o agente com Claude |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Modelo do agente |
| `MARKET_DATA_MODE` | `live` | `live` tenta fontes reais com fallback demo; `demo` só demo |
| `COINGECKO_API_KEY`, `ALPHAVANTAGE_API_KEY`, `BRAPI_TOKEN` | vazio | Provedores opcionais |
| `MARKET_CACHE_MINUTES` | `60` | Cache dos provedores |
| `MONITOR_SCHEDULER_ENABLED` | `true` | Agendador em processo |
| `MONITOR_DAILY_UTC` | `21:30` | Horário da execução diária (após B3 e NYSE) |
| `CRON_SECRET` | vazio | Protege `GET/POST /api/cron/monitor` |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM` | vazio | E-mail |
| `ATLAS_TODAY` | vazio | Fixa a data “de hoje” (testes/demonstrações) |

### Usando PostgreSQL / Supabase

```bash
export DATABASE_URL=postgres://user:pass@host:5432/atlas
npm run db:migrate && npm run db:seed && npm start
```

A migração cria o papel `atlas_app` (requer permissão de `CREATE ROLE`, disponível para o usuário `postgres` do Supabase) e as políticas RLS. A autenticação é própria (e-mail/senha com scrypt e sessões httpOnly); migrar para Supabase Auth exige apenas trocar `src/server/services/auth.ts` e preencher `app.user_id` com o `sub` do JWT.

### Monitoramento agendado

- **Em processo:** ativo por padrão; executa uma vez por dia após `MONITOR_DAILY_UTC`, para todos os usuários com perfil.
- **Externo/serverless:** `MONITOR_SCHEDULER_ENABLED=false` e chame `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/monitor`.
- **CLI:** `npm run monitor` (com PGlite, pare o servidor antes — o banco embutido é de processo único).
- **Manual:** botão “Executar monitoramento” no dashboard/alertas.

---

## Testes

```bash
npm test          # 61 testes (Vitest)
npm run typecheck
```

- `tests/finance.test.ts` — matemática financeira e avaliação de posições.
- `tests/risk-profile.test.ts` — motor de risco, perfil, elegibilidade, “dados insuficientes”.
- `tests/builder.test.ts` — limites, exclusões, estresse cambial, viabilidade da meta.
- `tests/alerts.test.ts` — regras, severidade, deduplicação, calendário e frescor dos dados.
- `tests/providers.test.ts` — parsers dos provedores (formatos reais) e importação CSV.
- `tests/isolation.test.ts` — isolamento entre usuários com Postgres real (PGlite) e RLS: leitura, escrita, exclusão, inserção em nome de terceiros, sessões e auditoria.

O fluxo de ponta a ponta (cadastro → onboarding → descoberta/comparação → builder → portfólio → cenário demo → monitoramento → alerta → agente → exportação LGPD) foi validado com Playwright contra o build de produção.

---

## Integrações

| Integração | Situação |
|---|---|
| Banco Central — SGS (CDI 12, Selic 432, IPCA 12m 13522, PTAX 1) | **Implementada**, sem chave. Parser testado com amostras; não validada contra o endpoint real neste ambiente |
| U.S. Treasury — Daily Par Yield Curve (3M, 10Y) | **Implementada**, sem chave. Idem |
| CoinGecko — histórico diário BTC, ETH, SOL, USDC, USDT | **Implementada** (chave opcional). Idem |
| Alpha Vantage — ações/ETFs EUA | **Implementada**, requer chave. Plano gratuito tem limite diário baixo |
| brapi.dev — B3 (BOVA11, IVVB11, ações, FIIs) | **Implementada**, requer token |
| Anthropic Claude — agente com ferramentas | **Implementada** (`@anthropic-ai/sdk`, loop de tool use, fallback de recusa no servidor). Não executada aqui por falta de chave; o analista por regras foi testado |
| Notificação in-app | **Funcional** |
| E-mail (Resend) e webhook HTTPS (Slack/Teams/Telegram via bridge) | **Implementados**, aguardando configuração |
| B3 oficial (UP2DATA), Tesouro Direto (preços/taxas), SEC EDGAR, dados on-chain, plataformas de RWA, notícias | **Pendentes** — a camada `src/server/providers` está preparada |
| OpenAI | **Pendente** — implementar `AgentProvider` em `src/server/ai/providers.ts` |
| Supabase Auth, integração com corretoras (somente leitura) | **Pendentes** |

---

## Limitações conhecidas

- **Dados:** neste ambiente todos os preços e indicadores são de **demonstração**. Características dos produtos (taxas, ratings, elegibilidade, tributação) são ilustrativas. Nenhuma fonte é tratada como tempo real ou preço executável.
- **Metodologia:** premissas de prêmio de risco por classe são simples e estáticas; IPCA 12 meses é usado como proxy da inflação futura; o modelo lognormal não captura caudas pesadas além da volatilidade histórica; correlações cross-currency usam premissas; tributação é estimada apenas para regimes brasileiros e de forma simplificada.
- **Renda fixa** é avaliada pela curva contratual (valor estimado), não por marcação a mercado diária.
- **Histórico da carteira** no dashboard é a simulação da composição atual (quantidades e câmbio constantes), não rentabilidade realizada — rotulado como tal.
- **Calendário de feriados** cobre 2024–2027; fora disso só fins de semana.
- **PGlite** é de processo único: para várias instâncias ou cron externo concorrente, use PostgreSQL.
- **Agente sem chave de IA** não interpreta perguntas livres (gera o relatório padrão).
- **Fuso:** a “data de hoje” do servidor é UTC.

## Regulação e privacidade

As análises são informativas. Antes de oferecer recomendações personalizadas comercialmente é necessária **avaliação jurídica** sobre a estrutura do serviço, o público e as autorizações aplicáveis (ex.: analista/consultor de valores mobiliários na CVM; investment adviser na SEC/estados nos EUA). Um disclaimer, isoladamente, não elimina essas obrigações.

LGPD: consentimento no cadastro, isolamento por usuário no banco, exportação dos dados (`Configurações › Exportar meus dados`), exclusão da conta e trilha de auditoria somente-inclusão. Credenciais de corretoras não são solicitadas nem armazenadas.
