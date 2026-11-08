import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import {
  readBusinessCard,
  readCardPhones,
  readCardSettings,
  type BusinessCardData,
  type BusinessCardRow,
  type CardPhone,
  type CardSettings,
} from "@/lib/business-card";

/**
 * The one callable behind business cards (docs/BUSINESS_CARDS.md,
 * `businessCards` in the functions). Every call here ends: a hung request
 * becomes an error after CALL_TIMEOUT_MS, so no screen waits forever.
 */
const CALL_TIMEOUT_MS = 20_000;

async function call(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await httpsCallable<Record<string, unknown>, Record<string, unknown>>(
    functions,
    "businessCards",
    { timeout: CALL_TIMEOUT_MS },
  )(data);
  return (result.data ?? {}) as Record<string, unknown>;
}

/** What a scan shows: the card, or null when the code opens nothing. */
export async function fetchBusinessCard(code: string): Promise<BusinessCardData | null> {
  const answer = await call({ action: "get", code });
  return answer.found === true ? readBusinessCard(answer.card) : null;
}

export type BusinessCardList = {
  canEdit: boolean;
  settings: CardSettings;
  cards: BusinessCardRow[];
};

/** The business's cards for its console; the first is the business's own. */
export async function listBusinessCards(businessId: string): Promise<BusinessCardList> {
  const answer = await call({ action: "list", businessId });
  const rows = Array.isArray(answer.cards) ? answer.cards : [];
  return {
    canEdit: answer.canEdit === true,
    settings: readCardSettings(answer.settings),
    cards: rows.flatMap((raw) => {
      const card = readBusinessCard(raw);
      const row = raw as Record<string, unknown>;
      return card
        ? [{ ...card, uid: String(row.uid ?? ""), mine: row.mine === true, canEditPhones: row.canEditPhones === true }]
        : [];
    }),
  };
}

/** Saves how the business's cards look; the owner's choice. */
export async function saveBusinessCardSettings(
  businessId: string,
  settings: CardSettings,
): Promise<CardSettings> {
  const answer = await call({ action: "saveSettings", businessId, settings });
  return readCardSettings(answer.settings);
}

/**
 * Saves a person's extra numbers (the whole list; empty clears it): the
 * caller's own, or a colleague's for someone who manages the team. The
 * numbers as the server kept them.
 */
export async function saveCardPhones(businessId: string, uid: string, phones: CardPhone[]): Promise<CardPhone[]> {
  const answer = await call({ action: "savePhones", businessId, uid, phones });
  return readCardPhones(answer.phones);
}

/** The codes the server refused a save with, e.g. `tagline_too_long`. */
export function cardSaveReasons(error: unknown): string[] {
  const details = (error as { details?: { reasons?: unknown } } | null)?.details;
  return Array.isArray(details?.reasons) ? details.reasons.map(String) : [];
}
