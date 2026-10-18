"use client";

import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const PALETTE = ["hsl(172 70% 30%)", "hsl(224 60% 45%)", "hsl(38 90% 50%)", "hsl(268 55% 55%)", "hsl(196 75% 45%)", "hsl(350 65% 52%)", "hsl(140 45% 42%)", "hsl(25 85% 52%)", "hsl(210 15% 55%)", "hsl(300 40% 50%)", "hsl(60 60% 42%)"];

export function Donut({ data, height = 220, format = "pct" }: { data: { name: string; value: number }[]; height?: number; format?: "pct" | "money" }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
      <div style={{ height }} className="mx-auto w-full max-w-[200px]">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => `${((Number(v) / total) * 100).toFixed(1)}%`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="tabular text-muted-foreground">{format === "pct" ? `${((d.value / (total || 1)) * 100).toFixed(1)}%` : d.value.toLocaleString("pt-BR")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PerformanceChart({ data, series }: { data: Record<string, number | string>[]; series: { key: string; label: string; color: string }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5).split("-").reverse().join("/")} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={44} />
          <Tooltip formatter={(v) => Number(v).toFixed(1)} labelFormatter={(d) => String(d).split("-").reverse().join("/")} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={s.key === "portfolio" ? 2.2 : 1.4} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceChart({ data, demo }: { data: { date: string; close: number }[]; demo?: boolean }) {
  const color = demo ? "hsl(268 70% 52%)" : "hsl(172 70% 30%)";
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -6, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => `${d.slice(5, 7)}/${d.slice(2, 4)}`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={50} />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={56} />
          <Tooltip formatter={(v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} labelFormatter={(d) => String(d).split("-").reverse().join("/")} />
          <Area type="monotone" dataKey="close" name={demo ? "Preço (DEMO)" : "Preço"} stroke={color} fill="url(#pc)" strokeWidth={1.6} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
