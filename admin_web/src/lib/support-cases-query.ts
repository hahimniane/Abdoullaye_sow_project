/**
 * The support inbox query, newest activity first.
 *
 * The inbox used to be `where(scope) + limit(300)` with no order, which
 * Firestore answers with the first 300 cases by document id: past 300, new
 * cases never reached the inbox. Every supportCases writer in
 * functions/index.js (openSupportCase, createBusinessPlatformSupportCase and
 * each message, status, claim and escalation callable) stamps `updatedAt`, so
 * ordering by it drops no case and puts the latest activity on page one.
 *
 * Pure - no Firebase import - so the shape is unit-tested in node.
 */

import type { QueryFilterSpec, QueryOrderSpec } from "./paged-query.ts";

export const SUPPORT_CASES_PAGE_SIZE = 50;

export type SupportInboxScope = "business" | "admin";

export function supportCasesQuerySpec(
  scope: SupportInboxScope,
  businessId: string,
): { filters: QueryFilterSpec[]; orderBy: QueryOrderSpec } {
  return {
    filters: scope === "business"
      ? [["businessId", "==", businessId]]
      : [["escalationStatus", "==", "escalated"]],
    orderBy: { field: "updatedAt", direction: "desc" },
  };
}
