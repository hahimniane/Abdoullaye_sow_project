/**
 * What the labels dialog says while it prints straight to the label printer:
 * one state, one sentence, in the reader's language.
 *
 * The sentences carry counts ("Printing label 2 of 5..."), so they are built
 * here for English and French and shown in an element marked
 * `data-no-translate` (the dictionary does not see them). Pure - no DOM, no
 * Bluetooth - so `label-printer-status.test.ts` runs it directly.
 */

import { PrinterError, type PrintProgress } from "./pm241.ts";

export type Lang = "en" | "fr";

export type LabelPrinterState =
  | { phase: "idle" }
  /** Asking the browser for the printer / opening the Bluetooth link. */
  | { phase: "connecting" }
  /** Fetching the labels and drawing them. */
  | { phase: "preparing" }
  | { phase: "printing"; index: number; total: number; percent: number }
  /** `unconfirmed`: the printer cannot say a label came out (the beta printers), so it was only sent. */
  | { phase: "done"; count: number; unconfirmed?: boolean }
  | { phase: "empty" }
  | { phase: "failed"; message: string }
  /** The browser's printer chooser was closed with nothing picked. */
  | { phase: "cancelled" };

/** True while something is under way: the buttons stay disabled and a spinner shows. */
export function labelPrinterBusy(state: LabelPrinterState): boolean {
  return state.phase === "connecting" || state.phase === "preparing" || state.phase === "printing";
}

/**
 * The state a progress report from the print loop puts the dialog in. Of each
 * label, sending its bytes is the first 90 %; the last 10 % is the printer
 * confirming it came out.
 */
export function stateFromProgress(progress: PrintProgress): LabelPrinterState {
  const share =
    progress.phase === "sending" ? (progress.bytes > 0 ? progress.sent / progress.bytes : 0) * 0.9 : progress.phase === "printing" ? 0.9 : 1;
  const done = progress.index - 1 + share;
  const percent = progress.total > 0 ? Math.max(0, Math.min(100, Math.round((done / progress.total) * 100))) : 0;
  return { phase: "printing", index: progress.index, total: progress.total, percent };
}

function labelsWord(count: number, lang: Lang): string {
  if (lang === "fr") return count === 1 ? "étiquette" : "étiquettes";
  return count === 1 ? "label" : "labels";
}

/** "Printed 5 labels." / "5 étiquettes imprimées." */
export function printedText(count: number, lang: Lang): string {
  if (lang === "fr") return `${count} ${labelsWord(count, lang)} ${count === 1 ? "imprimée" : "imprimées"}.`;
  return `Printed ${count} ${labelsWord(count, lang)}.`;
}

/** "Sent 5 labels to the printer. Check that they came out." / French. */
export function sentText(count: number, lang: Lang): string {
  if (lang === "fr") {
    return `${count} ${labelsWord(count, lang)} ${count === 1 ? "envoyée" : "envoyées"} à l’imprimante. Vérifiez ${count === 1 ? "qu’elle est sortie" : "qu’elles sont sorties"}.`;
  }
  return `Sent ${count} ${labelsWord(count, lang)} to the printer. Check that ${count === 1 ? "it" : "they"} came out.`;
}

/** The sentence for a PrinterError, in the reader's language. */
export function printerErrorText(code: PrinterError["code"], lang: Lang): string {
  const fr = lang === "fr";
  switch (code) {
    case "no_credit":
      return fr
        ? "L’imprimante a cessé de répondre. Vérifiez qu’elle est allumée, qu’il y a du papier et qu’elle est proche, puis réessayez."
        : "The label printer stopped answering. Check that it is on, has labels and is close by, then try again.";
    case "not_confirmed":
      return fr
        ? "L’imprimante n’a pas confirmé l’étiquette. Regardez si elle est sortie avant de réimprimer, pour ne pas l’imprimer deux fois."
        : "The printer did not confirm the label. Check whether it came out before printing again, so you do not print it twice.";
    case "disconnected":
      return fr
        ? "L’imprimante s’est déconnectée. Allumez-la et réessayez."
        : "The label printer disconnected. Switch it on and try again.";
    case "write_failed":
      return fr
        ? "Impossible d’envoyer l’étiquette à l’imprimante. Réessayez."
        : "Could not send the label to the printer. Try again.";
    case "cancelled":
      return fr
        ? "Aucune imprimante n’a été choisie. Allumez-la, puis touchez de nouveau le bouton."
        : "No label printer was chosen. Switch it on, then tap the button again.";
    case "connect_failed":
    default:
      return fr
        ? "Impossible de se connecter à l’imprimante d’étiquettes. Allumez-la, gardez-la à proximité et réessayez."
        : "Could not connect to the label printer. Switch it on, keep it close and try again.";
  }
}

/**
 * The failure as one sentence, or null when `error` is not the printer's (a
 * refused request, for instance - the caller has its own words for that).
 * A batch that stopped part-way says how many came out first.
 */
export function printerFailureText(error: unknown, total: number, lang: Lang): string | null {
  if (!(error instanceof PrinterError)) return null;
  const base = printerErrorText(error.code, lang);
  if (error.printed > 0 && total > 0) {
    const lead = lang === "fr"
      ? `${error.printed} ${labelsWord(error.printed, lang)} sur ${total} ${error.printed === 1 ? "imprimée" : "imprimées"} avant l’arrêt.`
      : `${error.printed} of ${total} ${labelsWord(total, lang)} printed before it stopped.`;
    return `${lead} ${base}`;
  }
  return base;
}

/** What the dialog shows for `state`; empty when there is nothing to say. */
export function labelPrinterStatusText(state: LabelPrinterState, lang: Lang): string {
  const fr = lang === "fr";
  switch (state.phase) {
    case "idle":
      return "";
    case "connecting":
      return fr ? "Connexion à l’imprimante d’étiquettes..." : "Connecting to the label printer...";
    case "preparing":
      return fr ? "Préparation des étiquettes..." : "Getting the labels ready...";
    case "printing":
      return fr
        ? `Impression de l’étiquette ${state.index} sur ${state.total}... (${state.percent} %)`
        : `Printing label ${state.index} of ${state.total}... (${state.percent}%)`;
    case "done":
      return state.unconfirmed ? sentText(state.count, lang) : printedText(state.count, lang);
    case "empty":
      return fr ? "Il n’y a aucune étiquette à imprimer." : "There are no labels to print.";
    case "cancelled":
      return printerErrorText("cancelled", lang);
    case "failed":
      return state.message;
  }
}

/** How the status is announced: errors interrupt, the rest wait their turn. */
export function labelPrinterStatusRole(state: LabelPrinterState): "alert" | "status" {
  return state.phase === "failed" ? "alert" : "status";
}
