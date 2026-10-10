import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path d="M8 19.5 22.5 9l1.5 1.5L13.5 24 12 22.5l2.5-4.5-4 .5L9 20z" className="fill-signal" />
      <circle cx="23.5" cy="22.5" r="2.2" className="fill-primary-foreground/90" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-lg font-semibold tracking-tight">FareBuddy</span>
    </span>
  );
}
