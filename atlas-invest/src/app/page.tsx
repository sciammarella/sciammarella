import Link from "next/link";
import { ArrowRight, BellRing, Bot, Compass, FlaskConical, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoLoginAction } from "./actions";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: Compass, title: "Descoberta de investimentos", text: "Renda fixa, Tesouro, ações, ETFs, FIIs, REITs, Treasuries, cripto, stablecoins e tokenizados — Brasil e EUA, filtrados pelo seu perfil." },
  { icon: Scale, title: "Risco explicável", text: "Nota de 1 a 10 com oito componentes (mercado, crédito, liquidez, câmbio, concentração, contraparte, regulatório, tecnológico) e limitações declaradas." },
  { icon: Sparkles, title: "Portfolio Builder", text: "Três alternativas comparáveis — conservadora, equilibrada e agressiva — com cenários, estresse, liquidez e custos." },
  { icon: Bot, title: "Agente de IA com evidências", text: "O modelo explica; cálculos, métricas e regras são determinísticos. Toda recomendação guarda dados, data e grau de confiança." },
  { icon: BellRing, title: "Monitor diário", text: "Variações relevantes, risco, câmbio, juros, eventos de crédito, perda de paridade e desvios de alocação — sem ruído." },
  { icon: ShieldCheck, title: "Sem promessas", text: "Se sua meta não cabe no seu perfil, dizemos isso. Nada de retornos garantidos e nenhuma ordem é executada." },
];

export default async function Landing() {
  const user = await getCurrentUser();
  return (
    <div className="min-h-screen bg-[hsl(224_50%_9%)] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-sky-600 font-bold">A</span>
          <span className="font-semibold">Atlas Invest AI</span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/methodology" className="hidden px-3 py-2 text-slate-300 hover:text-white sm:block">Metodologia</Link>
          {user ? (
            <Button asChild size="sm" variant="secondary"><Link href="/dashboard">Abrir dashboard</Link></Button>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 text-slate-300 hover:text-white">Entrar</Link>
              <Button asChild size="sm" variant="secondary"><Link href="/signup">Criar conta</Link></Button>
            </>
          )}
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-[0.07]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-14 sm:pt-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-300">
            <FlaskConical className="h-3.5 w-3.5 text-violet-300" /> MVP — análise, recomendação e monitoramento. Sem execução de ordens.
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] sm:text-6xl">
            Seu copiloto de investimentos no Brasil e nos EUA.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-300">
            Parta de um objetivo de rentabilidade, entenda quanto pode ganhar <em>e quanto pode perder</em>, monte portfólios coerentes com seu perfil e receba alertas
            quando algo relevante mudar.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="brand"><Link href={user ? "/dashboard" : "/signup"}>Começar agora <ArrowRight /></Link></Button>
            <form action={demoLoginAction}>
              <Button size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">Explorar conta demo</Button>
            </form>
          </div>
          <p className="mt-4 text-xs text-slate-400">A conta demo usa dados simulados claramente identificados com o selo DEMO.</p>
        </div>
      </section>

      <section className="bg-background text-foreground">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card p-6">
              <f.icon className="h-5 w-5 text-brand" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-16 text-xs text-muted-foreground">
          <p className="max-w-4xl">
            Atlas Invest AI é um produto em desenvolvimento. As análises têm caráter informativo e não constituem oferta, solicitação ou recomendação individualizada nos termos da
            regulação aplicável (CVM, SEC/FINRA). Retornos projetados são estimativas de modelo e não são garantidos. A oferta comercial de recomendações personalizadas depende
            de avaliação jurídica e das autorizações cabíveis. <Link href="/methodology" className="underline">Metodologia e limitações</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
