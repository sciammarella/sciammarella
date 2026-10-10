import { placeLabel, searchPlaces } from "@engine/airports.ts";
import { Building2, MapPin, PlaneTakeoff } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PlaceCombobox({
  value,
  onChange,
  placeholder,
  invalid,
  icon = "takeoff",
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  invalid?: boolean;
  icon?: "takeoff" | "pin";
}) {
  const [query, setQuery] = useState(value ? placeLabel(value) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => searchPlaces(query === (value ? placeLabel(value) : "") ? "" : query, 8), [query, value]);

  useEffect(() => setQuery(value ? placeLabel(value) : ""), [value]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const select = (code: string) => {
    onChange(code);
    setQuery(placeLabel(code));
    setOpen(false);
  };
  const Icon = icon === "takeoff" ? PlaneTakeoff : MapPin;

  return (
    <div ref={ref} className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid}
        className="pl-9"
        placeholder={placeholder}
        value={query}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            select(options[active].code);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          {options.map((o, i) => (
            <li
              key={o.code}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                select(o.code);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active && "bg-accent")}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                {o.kind === "metro" ? <Building2 className="h-4 w-4" /> : <PlaneTakeoff className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{o.sublabel}</span>
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{o.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
