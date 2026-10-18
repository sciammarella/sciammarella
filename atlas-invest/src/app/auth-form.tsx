"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { demoLoginAction, signInAction, signUpAction, type ActionResult } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(mode === "login" ? signInAction : signUpAction, null);
  return (
    <div className="grid min-h-screen place-items-center bg-[hsl(224_50%_9%)] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-7 shadow-xl">
        <Link href="/" className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-sky-600 text-sm font-bold text-white">A</span>
          <span className="font-semibold">Atlas Invest AI</span>
        </Link>
        <h1 className="text-xl font-semibold">{mode === "login" ? "Entrar" : "Criar conta"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mode === "login" ? "Acesse seus portfólios e alertas." : "Leva menos de 3 minutos para configurar seu perfil."}</p>
        <form action={action} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5"><Label htmlFor="name">Nome</Label><Input id="name" name="name" autoComplete="name" required /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="space-y-1.5"><Label htmlFor="password">Senha</Label><Input id="password" name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></div>
          {mode === "signup" && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="consent" className="mt-0.5" required />
              <span>Li e aceito o tratamento dos meus dados para fins de análise de investimentos (LGPD) e entendo que o Atlas não executa ordens nem garante retornos.</span>
            </label>
          )}
          {state && !state.ok && <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>}
          <Button className="w-full" disabled={pending}>{pending ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}</Button>
        </form>
        <form action={demoLoginAction} className="mt-3">
          <Button variant="outline" className="w-full">Entrar na conta demo</Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "login" ? <>Não tem conta? <Link href="/signup" className="font-medium text-foreground underline">Criar conta</Link></> : <>Já tem conta? <Link href="/login" className="font-medium text-foreground underline">Entrar</Link></>}
        </p>
      </div>
    </div>
  );
}
