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

/**
 * Which list: every case of the inbox, or only the WhatsApp conversations
 * (docs/WHATSAPP_CONVERSATIONS.md). Business staff without the Support
 * permission may run only the WhatsApp query; Laawol's WhatsApp view is every
 * conversation of every business.
 */
export type SupportInboxView = "cases" | "whatsapp";

export function supportCasesQuerySpec(
  scope: SupportInboxScope,
  businessId: string,
  view: SupportInboxView = "cases",
): { filters: QueryFilterSpec[]; orderBy: QueryOrderSpec } {
  if (view === "whatsapp") {
    return {
      filters: scope === "business"
        ? [["businessId", "==", businessId], ["caseType", "==", "whatsapp"]]
        : [["caseType", "==", "whatsapp"]],
      orderBy: { field: "updatedAt", direction: "desc" },
    };
  }
  return {
    filters: scope === "business"
      ? [["businessId", "==", businessId]]
      : [["escalationStatus", "==", "escalated"]],
    orderBy: { field: "updatedAt", direction: "desc" },
  };
}
