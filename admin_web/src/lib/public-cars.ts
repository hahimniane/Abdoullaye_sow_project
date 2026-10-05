// The public car listings, and the shape every customer collection hook
// returns. Extracted from customer-console so that the signed-out service
// entry can subscribe to listings without importing the whole customer
// console module - one hook was pulling 2,000 lines onto the guest's first
// paint.

import { useMemo } from "react";

import { customerCarListingIsEligible } from "@/lib/customer-service-eligibility";
import { usePagedQuery } from "@/lib/use-paged-query";
import type { FirestoreRow } from "@/types/admin";

export type CustomerCollection = {
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
  /** Present on server-paged lists: another page exists. */
  hasMore?: boolean;
  /** Present on server-paged lists: the next page is on its way. */
  loadingMore?: boolean;
  /** Present on server-paged lists: fetch the next page. */
  loadMore?: () => void;
};

export const PUBLIC_CARS_PAGE_SIZE = 100;

// Newest listings first, a page at a time. `limit(100)` with no order
// returned 100 active cars by document id, so a new listing could stay
// invisible to every customer. Every listing writer (business console,
// staff app, admin console, seeds) stamps createdAt, so the order drops none.
export function usePublicCars(enabled: boolean): CustomerCollection {
  const paged = usePagedQuery({
    source: enabled ? { path: ["cars"] } : null,
    filters: [["status", "==", "active"]],
    orderBy: { field: "createdAt", direction: "desc" },
    pageSize: PUBLIC_CARS_PAGE_SIZE,
    enabled,
  });
  const rows = useMemo(
    () => paged.rows.filter(customerCarListingIsEligible),
    [paged.rows],
  );
  return {
    rows,
    loading: paged.loading,
    error: paged.error,
    hasMore: paged.hasMore,
    loadingMore: paged.loadingMore,
    loadMore: paged.loadMore,
  };
}
