import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ amount, currency, className, decimals }: { amount: number | null | undefined; currency: string; className?: string; decimals?: boolean }) {
  return <span className={cn("tabular", className)}>{money(amount, currency, { decimals })}</span>;
}
