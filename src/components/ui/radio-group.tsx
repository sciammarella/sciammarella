import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";
import { cn } from "@/lib/utils";

const RadioGroup = RadioGroupPrimitive.Root;

/** Card-style radio option. */
const RadioCard = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>>(
  ({ className, children, ...props }, ref) => (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 text-left text-sm shadow-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-signal data-[state=checked]:bg-signal-soft/60 data-[state=checked]:ring-1 data-[state=checked]:ring-signal disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  ),
);
RadioCard.displayName = "RadioCard";

export { RadioCard, RadioGroup };
