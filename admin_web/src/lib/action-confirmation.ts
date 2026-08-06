import {
  currentWebLanguage,
  type SupportedLanguage,
} from "./language.ts";

export type ActionConfirmationOptions = {
  confirm?: string;
  confirmFr?: string;
};

export type ActionRunner = (
  label: string,
  action: () => Promise<unknown>,
  options?: ActionConfirmationOptions,
) => Promise<void> | void;

export function confirmationMessage(
  english: string,
  french?: string,
  language: SupportedLanguage = currentWebLanguage(),
) {
  return language === "fr" ? (french || english) : english;
}

/** A confirmation waiting on the user, as the dialog host sees it. */
export type PendingActionConfirmation = {
  id: number;
  english: string;
  french?: string;
};

type ConfirmationListener = (pending: PendingActionConfirmation | null) => void;

type QueuedConfirmation = PendingActionConfirmation & {
  settle: (confirmed: boolean) => void;
};

const listeners = new Set<ConfirmationListener>();
const queue: QueuedConfirmation[] = [];
let sequence = 0;

// The queue entry is handed to listeners as-is so its identity stays stable
// for a given confirmation. A fresh object per publish would restart the
// host's focus effects every time a second confirmation lines up behind the
// open one.
function head(): PendingActionConfirmation | null {
  return queue[0] ?? null;
}

function publish() {
  const pending = head();
  for (const listener of [...listeners]) listener(pending);
}

/**
 * Mounts the dialog host. The listener is called immediately with the current
 * request (if any) and again whenever the head of the queue changes.
 */
export function subscribeToActionConfirmations(listener: ConfirmationListener) {
  listeners.add(listener);
  listener(head());
  return () => {
    listeners.delete(listener);
  };
}

/** Answers a pending confirmation. Unknown ids are ignored (double answer). */
export function resolveActionConfirmation(id: number, confirmed: boolean) {
  const index = queue.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  const [entry] = queue.splice(index, 1);
  publish();
  entry.settle(confirmed);
}

/** Test seam: drop anything left over from a previous case. */
export function resetActionConfirmations() {
  while (queue.length) queue.pop()?.settle(false);
  listeners.clear();
}

/**
 * Asks the user to confirm an important action and resolves with their answer.
 *
 * This never calls window.confirm. A native dialog blocks the renderer's main
 * thread until it is dismissed - under automation that reads as a frozen tab,
 * and a browser configured to suppress dialogs answers "false" on the user's
 * behalf, turning a confirmed action into a silent no-op. The in-page dialog
 * (ActionConfirmationHost) keeps the page responsive and always shows.
 */
export function confirmImportantAction(
  english: string,
  french?: string,
): Promise<boolean> {
  // Server render, or a surface that does not mount the host. Nothing can ask
  // the user here, so approve rather than resolve false: the caller already
  // gated this on a deliberate click, and answering "no" for them would
  // reintroduce the silent no-op the native dialog caused.
  if (typeof window === "undefined" || listeners.size === 0) {
    return Promise.resolve(true);
  }
  sequence += 1;
  const id = sequence;
  return new Promise<boolean>((resolve) => {
    queue.push({id, english, french, settle: resolve});
    publish();
  });
}
