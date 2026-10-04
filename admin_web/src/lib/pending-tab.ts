/**
 * Opening a document whose URL comes back from a callable.
 *
 * A browser lets a page open a new tab only inside the click that asked for
 * it. `await callable(); window.open(url)` runs after the click has ended, so
 * popup blockers refuse it and the button looks like it did nothing. Open a
 * blank tab first, inside the click, then point it at the URL once the
 * server answers; when the browser refused even the blank tab, the caller
 * shows the URL as a link instead.
 *
 * Takes the window as a parameter so `pending-tab.test.ts` runs without a
 * browser.
 */

type Opener = Pick<Window, "open">;
type PendingTab = Pick<Window, "location" | "close" | "closed" | "opener">;

/** Call synchronously in the click handler, before any await. Null when blocked. */
export function openPendingTab(win: Opener | null | undefined): PendingTab | null {
  try {
    const tab = win?.open("", "_blank") ?? null;
    // `noopener` would make `open` return null, so cut the link by hand: the
    // document must not be able to navigate the console.
    if (tab) tab.opener = null;
    return tab;
  } catch {
    return null;
  }
}

/** Sends the pending tab to the URL. False when there is no tab to send. */
export function sendPendingTab(tab: PendingTab | null, url: string): boolean {
  if (!tab || tab.closed || !url) return false;
  try {
    tab.location.href = url;
    return true;
  } catch {
    return false;
  }
}

/** The callable failed: do not leave an empty tab behind. */
export function closePendingTab(tab: PendingTab | null): void {
  try {
    if (tab && !tab.closed) tab.close();
  } catch {
    // Already gone.
  }
}
