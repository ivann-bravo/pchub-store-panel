"use client";

import * as React from "react";
import { ChevronDown, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    // When no search query, show selected items at the top
    if (!q && selected.length > 0) {
      return [
        ...list.filter((o) => selected.includes(o.value)),
        ...list.filter((o) => !selected.includes(o.value)),
      ];
    }
    return list;
  }, [options, query, selected]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selected.includes(o.value));
  const someSelected = selected.length > 0;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAllFiltered = () => {
    const toAdd = filtered.map((o) => o.value);
    const merged = Array.from(new Set([...selected, ...toAdd]));
    onChange(merged);
  };

  const clearFiltered = () => {
    const toRemove = new Set(filtered.map((o) => o.value));
    onChange(selected.filter((v) => !toRemove.has(v)));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // Focus search on open
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            "flex h-9 items-center justify-between rounded-md border border-input bg-background px-3 text-sm ring-offset-background",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "transition-colors cursor-pointer select-none",
            className
          )}
        >
          <span className={cn("truncate", !someSelected && "text-muted-foreground")}>
            {someSelected ? placeholder : placeholder}
          </span>
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {someSelected && (
              <>
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {selected.length}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="flex items-center text-muted-foreground hover:text-foreground"
                  onClick={clearAll}
                  onKeyDown={(e) => e.key === "Enter" && clearAll(e as unknown as React.MouseEvent)}
                >
                  <X className="h-3 w-3" />
                </span>
              </>
            )}
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0 shadow-md"
        style={{ width: "var(--radix-popover-trigger-width)", minWidth: 200 }}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Select all / Clear */}
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <button
            type="button"
            onClick={selectAllFiltered}
            disabled={allFilteredSelected || filtered.length === 0}
            className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default"
          >
            {query ? "Seleccionar visibles" : "Seleccionar todo"}
          </button>
          <button
            type="button"
            onClick={clearFiltered}
            disabled={!filtered.some((o) => selected.includes(o.value))}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default"
          >
            Limpiar
          </button>
        </div>

        {/* Options list */}
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            filtered.map((opt) => {
              const isChecked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm",
                    "hover:bg-accent select-none",
                    isChecked && "bg-accent/40"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              );
            })
          )}
        </div>

        {/* Footer: selected count */}
        {someSelected && (
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            {selected.length} seleccionado{selected.length !== 1 ? "s" : ""}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
