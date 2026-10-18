"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { Strategy } from "@/domain/builder";
import { requireProfile, requireUser } from "@/lib/session";
import { generateAgentReport } from "@/server/ai/agent";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/server/bootstrap";
import { withSystem, withUser } from "@/server/db";
import { audit } from "@/server/services/audit";
import { AuthError, destroySession, SESSION_COOKIE, SESSION_MAX_AGE, signIn, signUp } from "@/server/services/auth";
import { applyDemoScenario, refreshMarketData } from "@/server/services/market-data";
import { runMonitoring, setAlertStatus } from "@/server/services/monitoring";
import { markAllRead } from "@/server/services/notifications";
import {
  addPosition, archivePortfolio, createPortfolio, deletePosition, duplicatePortfolio, fillFromTargets, importPositions, setTargets, updatePortfolio, updatePosition,
} from "@/server/services/portfolio";
import { saveProfile, savePreferences } from "@/server/services/profile";
import { generateProposals, getRecommendation } from "@/server/services/recommendations";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  return { ok: false, error: (e as Error)?.message ?? "Erro inesperado." };
}

async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
}

// ───────────── Auth ─────────────
export async function signUpAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    if (form.get("consent") !== "on") return { ok: false, error: "É necessário aceitar os termos e a política de privacidade." };
    const { token } = await signUp(String(form.get("email") ?? ""), String(form.get("password") ?? ""), String(form.get("name") ?? ""));
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    return fail(e);
  }
  redirect("/onboarding");
}

export async function signInAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { token } = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    return fail(e);
  }
  redirect("/dashboard");
}

export async function demoLoginAction(): Promise<void> {
  const { token } = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
  await setSessionCookie(token);
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  await destroySession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect("/");
}

// ───────────── Profile & preferences ─────────────
export async function saveProfileAction(answers: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => saveProfile(tx, user.id, answers));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function savePreferencesAction(input: { notifications?: unknown; thresholds?: unknown }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => savePreferences(tx, user.id, input));
    revalidatePath("/settings");
    return { ok: true, message: "Preferências salvas." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccountAction(confirm: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (confirm !== "EXCLUIR") return { ok: false, error: 'Digite EXCLUIR para confirmar.' };
    if (user.isDemo) return { ok: false, error: "A conta de demonstração não pode ser excluída." };
    await withSystem(async (tx) => {
      await audit(tx, null, "user", "account.deleted", "user", user.id, {});
      await tx.query(`delete from users where id = $1`, [user.id]);
    });
    const store = await cookies();
    store.delete(SESSION_COOKIE);
  } catch (e) {
    return fail(e);
  }
  redirect("/");
}

// ───────────── Market data & monitoring ─────────────
export async function runMonitoringAction(): Promise<ActionResult<{ alertsCreated: number; runId: string | null }>> {
  try {
    const user = await requireUser();
    const r = await runMonitoring(user.id, "manual");
    revalidatePath("/", "layout");
    return { ok: true, data: { alertsCreated: r.alertsCreated, runId: r.runId }, message: r.message };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshDataAction(): Promise<ActionResult> {
  try {
    await requireUser();
    const r = await refreshMarketData({ force: true });
    revalidatePath("/", "layout");
    const summary = r.map((x) => `${x.source}: ${x.status}`).join(" · ");
    return { ok: true, message: summary };
  } catch (e) {
    return fail(e);
  }
}

export async function applyScenarioAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const r = await withSystem((tx) => applyDemoScenario(tx, id));
    await withUser(user.id, (tx) => audit(tx, user.id, "user", "demo.scenario_applied", "demo_scenario", id, { changes: r.changes }));
    revalidatePath("/", "layout");
    return { ok: true, message: `Cenário "${r.label}" aplicado aos dados de demonstração: ${r.changes.join("; ")}. Execute o monitoramento para gerar alertas.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setAlertStatusAction(id: string, status: "open" | "acknowledged" | "resolved"): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => setAlertStatus(tx, user.id, id, status));
    revalidatePath("/alerts");
    revalidatePath(`/alerts/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => markAllRead(tx));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ───────────── Builder & portfolios ─────────────
export async function generateProposalsAction(amount: number | null): Promise<ActionResult<{ recommendationId: string }>> {
  try {
    const { user, profile } = await requireProfile();
    const r = await withUser(user.id, (tx) => generateProposals(tx, user.id, profile, amount ?? undefined));
    revalidatePath("/recommendations");
    return { ok: true, data: { recommendationId: r.recommendationId } };
  } catch (e) {
    return fail(e);
  }
}

export async function savePortfolioFromProposalAction(recommendationId: string, strategy: Strategy, name: string, fillAmount: number | null): Promise<ActionResult<{ portfolioId: string }>> {
  try {
    const { user, profile } = await requireProfile();
    const id = await withUser(user.id, async (tx) => {
      const r = await getRecommendation(tx, recommendationId);
      if (!r) throw new Error("Proposta não encontrada.");
      const body = r.rec.body as { proposals: { strategy: Strategy; label: string; lines: { assetId: string; weight: number; rationale: string }[] }[] };
      const p = body.proposals.find((x) => x.strategy === strategy);
      if (!p) throw new Error("Alternativa não encontrada.");
      const pid = await createPortfolio(tx, user.id, {
        name: name.trim() || `Carteira ${p.label}`,
        description: `Criada a partir da proposta ${p.label} de ${new Date(r.rec.created_at).toLocaleDateString("pt-BR")}.`,
        baseCurrency: profile.answers.baseCurrency,
        strategy,
        sourceRecommendationId: recommendationId,
        targets: p.lines.map((l) => ({ assetId: l.assetId, weight: Math.floor(l.weight * 10000) / 10000, rationale: l.rationale })),
      });
      if (fillAmount && fillAmount > 0) await fillFromTargets(tx, user.id, pid, fillAmount);
      return pid;
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { portfolioId: id } };
  } catch (e) {
    return fail(e);
  }
}

export async function createPortfolioAction(input: { name: string; description: string }): Promise<ActionResult<{ portfolioId: string }>> {
  try {
    const { user, profile } = await requireProfile();
    const id = await withUser(user.id, (tx) => createPortfolio(tx, user.id, { name: input.name, description: input.description, baseCurrency: profile.answers.baseCurrency }));
    revalidatePath("/", "layout");
    return { ok: true, data: { portfolioId: id } };
  } catch (e) {
    return fail(e);
  }
}

export async function updatePortfolioAction(id: string, input: { name: string; description: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => updatePortfolio(tx, user.id, id, input));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicatePortfolioAction(id: string): Promise<ActionResult<{ portfolioId: string }>> {
  try {
    const user = await requireUser();
    const newId = await withUser(user.id, (tx) => duplicatePortfolio(tx, user.id, id));
    revalidatePath("/", "layout");
    return { ok: true, data: { portfolioId: newId } };
  } catch (e) {
    return fail(e);
  }
}

export async function archivePortfolioAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => archivePortfolio(tx, user.id, id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addPositionAction(input: { portfolioId: string; assetId: string; quantity: number; avgPrice: number; acquiredAt: string; manualValue: number | null; notes: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => addPosition(tx, user.id, { ...input, origin: "manual" }));
    revalidatePath(`/portfolios/${input.portfolioId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updatePositionAction(portfolioId: string, id: string, input: { quantity: number; avgPrice: number; acquiredAt: string; manualValue: number | null; notes: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => updatePosition(tx, user.id, id, input));
    revalidatePath(`/portfolios/${portfolioId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePositionAction(portfolioId: string, id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => deletePosition(tx, user.id, id));
    revalidatePath(`/portfolios/${portfolioId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function importCsvAction(portfolioId: string, csv: string): Promise<ActionResult<{ imported: number }>> {
  try {
    const user = await requireUser();
    const r = await withUser(user.id, (tx) => importPositions(tx, user.id, portfolioId, csv));
    if (r.errors.length) return { ok: false, error: r.errors.join(" ") };
    revalidatePath(`/portfolios/${portfolioId}`);
    return { ok: true, data: { imported: r.imported }, message: `${r.imported} posição(ões) importada(s).` };
  } catch (e) {
    return fail(e);
  }
}

export async function setTargetsAction(portfolioId: string, targets: { assetId: string; weight: number }[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withUser(user.id, (tx) => setTargets(tx, user.id, portfolioId, targets));
    revalidatePath(`/portfolios/${portfolioId}`);
    return { ok: true, message: "Alocação-alvo salva." };
  } catch (e) {
    return fail(e);
  }
}

export async function fillFromTargetsAction(portfolioId: string, amount: number): Promise<ActionResult<{ created: number }>> {
  try {
    const user = await requireUser();
    const n = await withUser(user.id, (tx) => fillFromTargets(tx, user.id, portfolioId, amount));
    revalidatePath(`/portfolios/${portfolioId}`);
    return { ok: true, data: { created: n }, message: `${n} posição(ões) criada(s) a partir da alocação-alvo.` };
  } catch (e) {
    return fail(e);
  }
}

// ───────────── Agent ─────────────
export async function agentReportAction(input: { question?: string; portfolioId?: string }): Promise<ActionResult<{ recommendationId: string }>> {
  try {
    const user = await requireUser();
    const id = await generateAgentReport(user.id, input);
    revalidatePath("/recommendations");
    return { ok: true, data: { recommendationId: id } };
  } catch (e) {
    return fail(e);
  }
}
