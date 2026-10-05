"use client";

import { useEffect, useSyncExternalStore } from "react";

import { carCatalogLoaded, loadCarCatalog, subscribeCarCatalog } from "./car-catalog.ts";

/**
 * Load the make/model/year catalog for a picker and re-render once it is in.
 * Returns whether it has loaded; before then getMakes() etc. return [].
 */
export function useCarCatalog(): boolean {
  const ready = useSyncExternalStore(subscribeCarCatalog, carCatalogLoaded, () => false);
  useEffect(() => {
    loadCarCatalog().catch(() => undefined);
  }, []);
  return ready;
}
