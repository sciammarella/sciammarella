"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Strategy } from "@/domain/builder";
import { generateProposalsAction, savePortfolioFromProposalAction } from "@/app/actions";

export function GenerateForm({ defaultAmount, currency }: { defaultAmount: number; currency: string }) {
  const [amount, setAmount] = useState(defaultAmount);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await generateProposalsAction(amount);
        if (r.ok && r.data) router.push(`/builder?rec=${r.data.recommendationId}`);
        else if (!r.ok) toast.error(r.error);
      });
    }}>
      <div className="space-y-1.5 sm:w-64">
        <Label htmlFor="amount">Valor a investir ({currency})</Label>
        <Input id="amount" type="number" min={100} step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </div>
      <Button variant="brand" disabled={pending || !(amount > 0)}><Sparkles /> {pending ? "Calculando…" : "Gerar três alternativas"}</Button>
      <p className="text-xs text-muted-foreground sm:ml-2 sm:max-w-md">Cálculos determinísticos (risco, cenários, estresse, liquidez e custos). Cada geração fica salva no histórico de recomendações com evidências.</p>
    </form>
  );
}

export function SaveProposal({ recommendationId, strategy, label, amount, currency, compatible }: { recommendationId: string; strategy: Strategy; label: string; amount: number; currency: string; compatible: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`Carteira ${label}`);
  const [fill, setFill] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="w-full" variant={compatible ? "default" : "outline"}><Save /> Salvar como portfólio</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar alternativa {label}</DialogTitle>
          <DialogDescription>A alocação vira a alocação-alvo do portfólio e passa a ser monitorada. {!compatible && "Atenção: esta alternativa está fora dos limites do seu perfil."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="pname">Nome do portfólio</Label><Input id="pname" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} className="mt-1" />
            <span>Criar posições planejadas com {currency} {amount.toLocaleString("pt-BR")} conforme a alocação (aos preços atuais). <span className="text-muted-foreground">Você pode editar quantidades depois; nenhuma ordem é enviada.</span></span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={pending || !name.trim()} onClick={() => start(async () => {
            const r = await savePortfolioFromProposalAction(recommendationId, strategy, name, fill ? amount : null);
            if (r.ok && r.data) { toast.success("Portfólio salvo."); router.push(`/portfolios/${r.data.portfolioId}`); }
            else if (!r.ok) toast.error(r.error);
          })}>{pending ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
