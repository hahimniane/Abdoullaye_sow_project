"use client";

import { useCallback, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { containerCallableFailure } from "@/lib/container-manifest";
import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import {
  labelPrinterBusy,
  printerFailureText,
  stateFromProgress,
  type LabelPrinterState,
} from "@/lib/label-printer-status";
import { renderPackageLabelBitmap } from "@/lib/package-label-canvas";
import {
  PACKAGE_LABEL_COPIES_PRINTER,
  packageLabelSetFromResponse,
  packageLabelsRequest,
} from "@/lib/package-labels";
import { genericPrinterDetailsText, noteGenericPrintFailure } from "@/lib/generic-printer";
import type { PrinterKind } from "@/lib/generic-label-printer";
import { PrinterError, printLabels } from "@/lib/pm241";
import { connectLabelPrinter, labelPrinterKind, labelPrinterSupported, setLabelPrinterKind } from "@/lib/pm241-printer";

/** How long the labels callable may take before the print gives up. */
const LABELS_TIMEOUT_MS = 30000;

type LabelTarget = {
  businessId: string;
  /** Empty for packages still waiting for a container. */
  containerId: string;
  /** One line on the container (a reprint). */
  lineId: string;
  /** Waiting packages, by line id. */
  lineIds: readonly string[];
};

/**
 * Prints a dialog's package labels straight to the PM-241 label printer over
 * Web Bluetooth: connect (inside the click, which the browser's chooser
 * needs), ask `getPackageLabels` for the labels, draw each at 800 x 1180
 * dots and send it, one per piece. Every path ends in a state that is not
 * busy - a spinner never outlives the work.
 */
export function useLabelPrinter(target: LabelTarget) {
  const [state, setState] = useState<LabelPrinterState>({ phase: "idle" });
  // The dialog mounts only after a click, never in the static export, so the
  // browser can be asked right away (no flash of "not supported" on Chrome).
  const [supported] = useState(() => labelPrinterSupported());
  const running = useRef(false);
  // Which printer: the PM-241 or the beta "other" one. Remembered in this browser.
  const [kind, setKindState] = useState<PrinterKind>(() => labelPrinterKind());
  // The printer details block (beta printers): shown after a failure or when asked for.
  const [details, setDetails] = useState("");
  const [copy, setCopy] = useState<"idle" | "copied" | "manual" | "empty">("idle");

  const setKind = useCallback((next: PrinterKind) => {
    setLabelPrinterKind(next);
    setKindState(next);
    setDetails("");
    setCopy("idle");
    setState({ phase: "idle" });
  }, []);

  /** Shows the details and puts them on the clipboard; the box stays as the fallback. */
  const copyDetails = useCallback(() => {
    const block = genericPrinterDetailsText();
    setDetails(block);
    if (!block) {
      setCopy("empty");
      return;
    }
    try {
      void navigator.clipboard.writeText(block).then(
        () => setCopy("copied"),
        () => setCopy("manual"),
      );
    } catch {
      setCopy("manual");
    }
  }, []);

  const print = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const lang = currentLanguage() === "fr" ? "fr" : "en";
    let total = 0;
    setState({ phase: "connecting" });
    try {
      // First, with nothing awaited before it: the chooser needs the click.
      const link = await connectLabelPrinter();
      setState({ phase: "preparing" });
      const response = await httpsCallable(functions, "getPackageLabels", { timeout: LABELS_TIMEOUT_MS })(
        packageLabelsRequest({
          businessId: target.businessId,
          containerId: target.containerId,
          lineId: target.lineId,
          lineIds: target.lineIds,
          copies: PACKAGE_LABEL_COPIES_PRINTER,
        }),
      );
      const set = packageLabelSetFromResponse(response.data);
      total = set.labels.length;
      if (total === 0) {
        setState({ phase: "empty" });
        return;
      }
      const printed = await printLabels(
        link,
        total,
        (index) => renderPackageLabelBitmap(set.labels[index], set),
        (progress) => setState(stateFromProgress(progress)),
      );
      setState({ phase: "done", count: printed, unconfirmed: link.confirmsLabels === false });
    } catch (error) {
      if (error instanceof PrinterError && error.code === "cancelled") {
        setState({ phase: "cancelled" });
      } else {
        if (labelPrinterKind() === "generic") {
          // A beta printer that failed: offer the details right away.
          noteGenericPrintFailure(error);
          setCopy("idle");
          setDetails(genericPrinterDetailsText());
        }
        const own = printerFailureText(error, total, lang);
        setState({
          phase: "failed",
          message: own ?? containerCallableFailure(error).message,
        });
      }
    } finally {
      running.current = false;
    }
  }, [target.businessId, target.containerId, target.lineId, target.lineIds]);

  return { state, supported, busy: labelPrinterBusy(state), print, kind, setKind, details, copy, copyDetails };
}
