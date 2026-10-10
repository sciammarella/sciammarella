import type { RuntimeMode } from "@engine/types.ts";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ModeBadge({ mode, className }: { mode: RuntimeMode; className?: string }) {
  return mode === "demo" ? (
    <Badge variant="demo" className={className}>
      <FlaskConical className="h-3 w-3" /> Demo
    </Badge>
  ) : (
    <Badge variant="signal" className={className}>
      <ShieldCheck className="h-3 w-3" /> Live
    </Badge>
  );
}
