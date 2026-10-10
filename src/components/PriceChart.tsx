import type { PriceObservation } from "@engine/types.ts";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateTime, money } from "@/lib/format";

export function PriceChart({ observations, target, max, currency, height = 260 }: { observations: PriceObservation[]; target: number; max: number; currency: string; height?: number }) {
  const data = observations.filter((o) => o.eligible).map((o) => ({ t: Date.parse(o.observedAt), price: o.totalPrice }));
  if (data.length === 0) {
    return <div className="flex items-center justify-center rounded-xl bg-muted/50 text-sm text-muted-foreground" style={{ height }}>No eligible price observations yet</div>;
  }
  const prices = data.map((d) => d.price);
  const lo = Math.min(...prices, target);
  const hi = Math.max(...prices, target);
  const pad = Math.max(20, (hi - lo) * 0.15);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--signal))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--signal))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[Math.floor(lo - pad), Math.ceil(hi + pad)]}
            tickFormatter={(v) => money(v, currency)}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 }}
            labelFormatter={(t) => dateTime(new Date(Number(t)).toISOString())}
            formatter={(v) => [money(Number(v), currency, { decimals: true }), "Best eligible total"]}
          />
          {max > target && <ReferenceLine y={max} stroke="hsl(var(--warn))" strokeDasharray="4 4" label={{ value: `Max ${money(max, currency)}`, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--warn))" }} />}
          <ReferenceLine y={target} stroke="hsl(var(--signal))" strokeDasharray="4 4" label={{ value: `Target ${money(target, currency)}`, position: "insideBottomRight", fontSize: 11, fill: "hsl(var(--signal))" }} />
          <Area type="monotone" dataKey="price" stroke="hsl(var(--foreground))" strokeWidth={2} fill="url(#priceFill)" dot={data.length < 40} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={className} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / span) * 26 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
