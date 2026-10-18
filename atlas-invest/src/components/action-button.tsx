"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/app/actions";

export function ActionButton<T>({ action, children, pendingLabel, confirm, onDone, ...props }: Omit<ButtonProps, "onClick" | "action"> & {
  action: () => Promise<ActionResult<T>>;
  pendingLabel?: string;
  confirm?: string;
  onDone?: (r: ActionResult<T>) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const r = await action();
          if (r.ok) {
            if (r.message) toast.success(r.message);
            router.refresh();
          } else toast.error(r.error);
          onDone?.(r);
        });
      }}
    >
      {pending ? pendingLabel ?? "Processando…" : children}
    </Button>
  );
}
