"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archivePortfolioAction, createPortfolioAction, duplicatePortfolioAction } from "@/app/actions";

export function NewPortfolioButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="brand"><Plus /> Novo portfólio</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo portfólio</DialogTitle><DialogDescription>Um portfólio vazio para registrar posições manualmente ou importar via CSV.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="n">Nome</Label><Input id="n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Aposentadoria" /></div>
          <div className="space-y-1.5"><Label htmlFor="d">Descrição (opcional)</Label><Textarea id="d" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={pending || !name.trim()} onClick={() => start(async () => {
            const r = await createPortfolioAction({ name, description });
            if (r.ok && r.data) router.push(`/portfolios/${r.data.portfolioId}`);
            else if (!r.ok) toast.error(r.error);
          })}>{pending ? "Criando…" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioRowActions({ id, redirectAfterArchive }: { id: string; redirectAfterArchive?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex shrink-0 gap-1">
      <Button size="icon" variant="ghost" title="Duplicar" disabled={pending} onClick={() => start(async () => {
        const r = await duplicatePortfolioAction(id);
        if (r.ok && r.data) { toast.success("Portfólio duplicado."); router.push(`/portfolios/${r.data.portfolioId}`); } else if (!r.ok) toast.error(r.error);
      })}><Copy /></Button>
      <Button size="icon" variant="ghost" title="Arquivar" disabled={pending} onClick={() => {
        if (!window.confirm("Arquivar este portfólio? Ele deixará de ser monitorado.")) return;
        start(async () => {
          const r = await archivePortfolioAction(id);
          if (r.ok) { toast.success("Portfólio arquivado."); if (redirectAfterArchive) router.push("/portfolios"); else router.refresh(); } else toast.error(r.error);
        });
      }}><Archive /></Button>
    </div>
  );
}
