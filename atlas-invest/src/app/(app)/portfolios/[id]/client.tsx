"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/app/actions";
import { addPositionAction, deletePositionAction, fillFromTargetsAction, importCsvAction, setTargetsAction, updatePortfolioAction, updatePositionAction } from "@/app/actions";

interface Option { id: string; label: string; currency: string; pricing: string; lastPrice: number | null }

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, success?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? success ?? "Salvo.");
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });
  return { pending, run };
}

const today = () => new Date().toISOString().slice(0, 10);

export function EditMeta({ id, name, description }: { id: string; name: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(name);
  const [d, setD] = useState(description);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Pencil /> Editar</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar portfólio</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Nome</Label><Input value={n} onChange={(e) => setN(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Descrição</Label><Textarea value={d} onChange={(e) => setD(e.target.value)} /></div>
        </div>
        <DialogFooter><Button disabled={pending || !n.trim()} onClick={() => run(() => updatePortfolioAction(id, { name: n, description: d }), "Portfólio atualizado.", () => setOpen(false))}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddPosition({ portfolioId, options, preselect }: { portfolioId: string; options: Option[]; preselect?: string }) {
  const [assetId, setAssetId] = useState(options.some((o) => o.id === preselect) ? preselect! : options[0].id);
  const opt = options.find((o) => o.id === assetId)!;
  const [quantity, setQuantity] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [acquiredAt, setAcquiredAt] = useState(today());
  const [manualValue, setManualValue] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, run } = useAction();
  const num = (s: string) => Number(s.replace(",", "."));
  return (
    <Card>
      <CardHeader><CardTitle>Adicionar posição manualmente</CardTitle><CardDescription>Nenhuma integração com corretora é necessária. Para renda fixa, informe quantidade = valor aplicado e preço médio = 1.</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          run(() => addPositionAction({ portfolioId, assetId, quantity: num(quantity), avgPrice: num(avgPrice), acquiredAt, manualValue: manualValue ? num(manualValue) : null, notes }), "Posição adicionada.", () => { setQuantity(""); setAvgPrice(""); setManualValue(""); setNotes(""); });
        }}>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="pos-asset">Ativo</Label>
            <NativeSelect id="pos-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect>
            <p className="text-xs text-muted-foreground">Moeda: {opt.currency} · {opt.pricing === "accrual" ? "avaliado pela curva contratual" : opt.lastPrice ? `último preço ${opt.lastPrice.toLocaleString("pt-BR")}` : "sem cotação"}</p>
          </div>
          <div className="space-y-1.5"><Label>Quantidade</Label><Input id="pos-qty" inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Preço médio ({opt.currency})</Label>
            <div className="flex gap-1"><Input inputMode="decimal" required value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} />
              {opt.pricing === "accrual" ? <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setAvgPrice("1")}>1</Button> : opt.lastPrice ? <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setAvgPrice(String(opt.lastPrice))}>atual</Button> : null}</div>
          </div>
          <div className="space-y-1.5"><Label>Data de aquisição</Label><Input type="date" max={today()} value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Valor atual informado (opcional)</Label><Input inputMode="decimal" placeholder="usa cotação/curva se vazio" value={manualValue} onChange={(e) => setManualValue(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Observações</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="sm:col-span-2"><Button disabled={pending}><Plus /> Adicionar posição</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PositionActions({ portfolioId, position, label }: { portfolioId: string; position: { id: string; quantity: number; avgPrice: number; acquiredAt: string; manualValue: number | null; notes: string }; label: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(String(position.quantity));
  const [p, setP] = useState(String(position.avgPrice));
  const [d, setD] = useState(position.acquiredAt);
  const [m, setM] = useState(position.manualValue == null ? "" : String(position.manualValue));
  const [n, setN] = useState(position.notes);
  const { pending, run } = useAction();
  const num = (s: string) => Number(s.replace(",", "."));
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="icon" variant="ghost" title="Editar"><Pencil /></Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar posição — {label}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Quantidade</Label><Input value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Preço médio</Label><Input value={p} onChange={(e) => setP(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Data de aquisição</Label><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Valor informado (opcional)</Label><Input value={m} onChange={(e) => setM(e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Observações</Label><Input value={n} onChange={(e) => setN(e.target.value)} /></div>
          </div>
          <DialogFooter><Button disabled={pending} onClick={() => run(() => updatePositionAction(portfolioId, position.id, { quantity: num(q), avgPrice: num(p), acquiredAt: d, manualValue: m ? num(m) : null, notes: n }), "Posição atualizada.", () => setOpen(false))}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size="icon" variant="ghost" title="Remover" disabled={pending} onClick={() => { if (window.confirm(`Remover a posição em ${label}?`)) run(() => deletePositionAction(portfolioId, position.id), "Posição removida."); }}><Trash2 /></Button>
    </div>
  );
}

export function ImportCsv({ portfolioId }: { portfolioId: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("ativo,quantidade,preco_medio,data_aquisicao\nBOVA11,100,125.50,2025-06-10\nUS-VOO,5,480,2025-03-02");
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader><CardTitle>Importar posições (CSV)</CardTitle><CardDescription>Posições importadas ficam marcadas como “Importado”, separadas das informadas manualmente.</CardDescription></CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="outline"><Upload /> Importar CSV</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Importar posições</DialogTitle><DialogDescription>Colunas: ativo (símbolo ou ID do catálogo), quantidade, preço médio, data (AAAA-MM-DD). Separador vírgula, ponto e vírgula ou tab.</DialogDescription></DialogHeader>
            <Textarea rows={8} className="font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
            <Input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
            <DialogFooter><Button disabled={pending} onClick={() => run(() => importCsvAction(portfolioId, csv), undefined, () => setOpen(false))}>{pending ? "Importando…" : "Importar"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function FillFromTargets({ portfolioId, currency }: { portfolioId: string; currency: string }) {
  const [amount, setAmount] = useState("");
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader><CardTitle>Gerar posições planejadas</CardTitle><CardDescription>Cria posições pela alocação-alvo aos preços atuais — útil para planejamento. Não envia ordens.</CardDescription></CardHeader>
      <CardContent className="flex gap-2">
        <Input placeholder={`Valor em ${currency}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button variant="outline" disabled={pending || !(Number(amount) > 0)} onClick={() => run(() => fillFromTargetsAction(portfolioId, Number(amount)))}><Wand2 /> Gerar</Button>
      </CardContent>
    </Card>
  );
}

export function TargetsEditor({ portfolioId, options, initial }: { portfolioId: string; options: Option[]; initial: { assetId: string; weight: number }[] }) {
  const [rows, setRows] = useState(initial.map((r) => ({ assetId: r.assetId, pct: String(Math.round(r.weight * 1000) / 10) })));
  const [adding, setAdding] = useState(options[0].id);
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.pct.replace(",", ".")) || 0), 0), [rows]);
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader><CardTitle>Alocação-alvo</CardTitle><CardDescription>Usada para medir desvios e gerar alertas de rebalanceamento. Soma atual: <b className={total > 100.01 ? "text-critical" : ""}>{total.toFixed(1)}%</b></CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r, i) => (
            <div key={r.assetId} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
              <span className="min-w-0 flex-1 truncate text-sm">{options.find((o) => o.id === r.assetId)?.label ?? r.assetId}</span>
              <Input className="h-8 w-20 text-right" value={r.pct} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
              <span className="text-sm">%</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <NativeSelect className="max-w-sm" value={adding} onChange={(e) => setAdding(e.target.value)}>{options.filter((o) => !rows.some((r) => r.assetId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect>
          <Button variant="outline" onClick={() => !rows.some((r) => r.assetId === adding) && setRows((s) => [...s, { assetId: adding, pct: "0" }])}><Plus /> Adicionar ativo</Button>
          <Button disabled={pending || total > 100.01} onClick={() => run(() => setTargetsAction(portfolioId, rows.map((r) => ({ assetId: r.assetId, weight: (Number(r.pct.replace(",", ".")) || 0) / 100 }))))}>Salvar alocação-alvo</Button>
        </div>
      </CardContent>
    </Card>
  );
}
