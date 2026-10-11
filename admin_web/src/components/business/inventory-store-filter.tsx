"use client";

import type { InventoryStore } from "@/lib/inventory";

/**
 * "All stores" or one store: the filter the products, sales and summary
 * share. It is only rendered for a viewer who may see every store of a
 * multi-store business; staff who work in one store never get it.
 */
export function InventoryStoreFilter({
  stores,
  value,
  onChange,
}: {
  stores: readonly InventoryStore[];
  /** "" = all stores. */
  value: string;
  onChange: (storeId: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by store">
      <option value="">All stores</option>
      {stores.map((store) => (
        <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
      ))}
    </select>
  );
}
