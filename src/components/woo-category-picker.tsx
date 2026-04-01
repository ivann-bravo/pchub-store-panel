"use client";

import { useEffect, useState } from "react";

interface WooCategory {
  wooId: number;
  name: string;
  parentId: number;
}

interface Props {
  /** Currently selected leaf wooId (null = none) */
  value: number | null;
  /** Called with (leafId | null, fullAncestorIdChain) */
  onChange: (wooId: number | null, allIds: number[]) => void;
  disabled?: boolean;
}

/** Depth-first traversal to build a display-ordered list with depth levels. */
function buildSortedList(cats: WooCategory[]): Array<{ cat: WooCategory; depth: number }> {
  const result: Array<{ cat: WooCategory; depth: number }> = [];
  const byParent = new Map<number, WooCategory[]>();
  for (const c of cats) {
    const children = byParent.get(c.parentId) ?? [];
    children.push(c);
    byParent.set(c.parentId, children);
  }

  function visit(parentId: number, depth: number) {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const c of children) {
      result.push({ cat: c, depth });
      visit(c.wooId, depth + 1);
    }
  }

  visit(0, 0);
  return result;
}

/** Returns [root, ..., leafId] — the full ancestor chain including the selected id. */
function getAncestorChain(leafId: number, cats: WooCategory[]): number[] {
  const map = new Map<number, WooCategory>();
  for (const c of cats) map.set(c.wooId, c);

  const chain: number[] = [];
  let current = map.get(leafId);
  while (current) {
    chain.unshift(current.wooId);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * Hierarchical WooCommerce category selector.
 * Shows all stored WC categories as an indented <select>.
 * Automatically computes the full ancestor chain for wooCategoryIds.
 */
export function WooCategoryPicker({ value, onChange, disabled }: Props) {
  const [cats, setCats] = useState<WooCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/woocommerce/categories")
      .then((r) => r.json())
      .then((data: WooCategory[]) => {
        setCats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sorted = buildSortedList(cats);

  // Non-breaking space for indentation (regular spaces collapse in <option>)
  const nbsp = "\u00a0";

  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      value={value ?? ""}
      disabled={disabled || loading}
      onChange={(e) => {
        const id = e.target.value ? Number(e.target.value) : null;
        onChange(id, id ? getAncestorChain(id, cats) : []);
      }}
    >
      <option value="">
        {loading ? "Cargando categorías..." : cats.length === 0 ? "Sin categorías (sincronizá en Configuración)" : "Sin categoría WC"}
      </option>
      {sorted.map(({ cat, depth }) => (
        <option key={cat.wooId} value={cat.wooId}>
          {nbsp.repeat(depth * 3)}{depth > 0 ? "↳ " : ""}{cat.name}
        </option>
      ))}
    </select>
  );
}
