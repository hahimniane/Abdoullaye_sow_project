// The one-time "the menu has moved" message shown when a business user first
// opens the console after the Shipping page arrived (2026-10-28). Each line is
// a fixed sentence (so the French dictionary can translate it whole); which
// lines show depends on the sections this person can open.

/** Per browser: once dismissed it stays dismissed. */
export const MENU_MOVED_NOTICE_KEY = "laawol:notice:menu-moved-2026-10";

/**
 * After this date nobody still remembers the old menu, and new staff never
 * saw it, so the message stops appearing.
 */
export const MENU_MOVED_NOTICE_UNTIL_MS = Date.UTC(2026, 11, 15);

const CAR_TABS = ["parking", "ledger", "transport", "listings", "purchases", "viewings"];

/** The sentences that apply to someone who can open these sections and Shipping steps. */
export function menuMovedLines(tabIds: readonly string[], stepIds: readonly string[] = []): string[] {
  const has = (id: string) => tabIds.includes(id);
  const lines: string[] = [];
  if (has("shipping")) {
    lines.push("Requests, Waiting list, Containers and Deliveries are now one page: Shipping. Its steps run along the top in the order a package moves.");
    if (stepIds.some((id) => id === "barrels" || id === "freight" || id === "volume")) {
      lines.push("Barrel orders, Freight and Volume (now This month) are at the end of the same row.");
    }
  }
  if (CAR_TABS.some(has)) {
    lines.push("Parking, Lot ledger, Transport jobs and car sales are under Cars.");
  }
  if (has("invoices") || has("inventory")) {
    lines.push("Invoices and Inventory are under Money.");
  }
  if (has("profile")) {
    lines.push("Your business details are now called Profile, under Business.");
  }
  return lines;
}

/** Whether to open the message now. */
export function shouldShowMenuMovedNotice(nowMs: number, dismissed: boolean, lines: readonly string[]) {
  return !dismissed && nowMs < MENU_MOVED_NOTICE_UNTIL_MS && lines.length > 0;
}

/** Read and write the per-browser flag; storage can be missing or blocked. */
export function readMenuMovedDismissed(): boolean {
  try {
    return window.localStorage.getItem(MENU_MOVED_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMenuMovedDismissed() {
  try {
    window.localStorage.setItem(MENU_MOVED_NOTICE_KEY, "1");
  } catch {
    // Private window or blocked storage: it may show again next visit.
  }
}
