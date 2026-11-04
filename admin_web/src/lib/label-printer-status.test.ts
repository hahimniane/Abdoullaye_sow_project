import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  labelPrinterBusy,
  labelPrinterStatusRole,
  labelPrinterStatusText,
  printedText,
  printerErrorText,
  printerFailureText,
  stateFromProgress,
  type LabelPrinterState,
} from "./label-printer-status.ts";
import { PrinterError, type PrinterErrorCode } from "./pm241.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("busy while connecting, preparing and printing - never after", () => {
  const busy: LabelPrinterState[] = [{ phase: "connecting" }, { phase: "preparing" }, { phase: "printing", index: 1, total: 2, percent: 10 }];
  const idle: LabelPrinterState[] = [{ phase: "idle" }, { phase: "done", count: 2 }, { phase: "empty" }, { phase: "failed", message: "x" }, { phase: "cancelled" }];
  assert.ok(busy.every(labelPrinterBusy));
  assert.ok(idle.every((state) => !labelPrinterBusy(state)));
});

test("progress: the percent climbs through each label and never passes 100", () => {
  const at = (p: Parameters<typeof stateFromProgress>[0]) => stateFromProgress(p) as Extract<LabelPrinterState, { phase: "printing" }>;
  assert.equal(at({ phase: "sending", index: 1, total: 2, sent: 0, bytes: 1000 }).percent, 0);
  assert.equal(at({ phase: "sending", index: 1, total: 2, sent: 500, bytes: 1000 }).percent, 23);
  assert.equal(at({ phase: "printing", index: 1, total: 2 }).percent, 45);
  assert.equal(at({ phase: "printed", index: 1, total: 2 }).percent, 50);
  assert.equal(at({ phase: "sending", index: 2, total: 2, sent: 1000, bytes: 1000 }).percent, 95);
  assert.equal(at({ phase: "printed", index: 2, total: 2 }).percent, 100);
  assert.equal(at({ phase: "sending", index: 1, total: 1, sent: 5, bytes: 0 }).percent, 0, "no bytes yet is not a division by zero");
});

test("every state reads in English and in French", () => {
  const states: LabelPrinterState[] = [
    { phase: "connecting" },
    { phase: "preparing" },
    { phase: "printing", index: 2, total: 5, percent: 30 },
    { phase: "done", count: 5 },
    { phase: "empty" },
    { phase: "cancelled" },
  ];
  for (const state of states) {
    const en = labelPrinterStatusText(state, "en");
    const fr = labelPrinterStatusText(state, "fr");
    assert.ok(en && fr && en !== fr, state.phase);
  }
  assert.equal(labelPrinterStatusText({ phase: "idle" }, "en"), "");
  assert.equal(labelPrinterStatusText({ phase: "printing", index: 2, total: 5, percent: 30 }, "en"), "Printing label 2 of 5... (30%)");
  assert.equal(labelPrinterStatusText({ phase: "printing", index: 2, total: 5, percent: 30 }, "fr"), "Impression de l’étiquette 2 sur 5... (30 %)");
  assert.equal(labelPrinterStatusText({ phase: "failed", message: "Nope." }, "fr"), "Nope.");
});

test("counts pluralise in both languages", () => {
  assert.equal(printedText(1, "en"), "Printed 1 label.");
  assert.equal(printedText(3, "en"), "Printed 3 labels.");
  assert.equal(printedText(1, "fr"), "1 étiquette imprimée.");
  assert.equal(printedText(3, "fr"), "3 étiquettes imprimées.");
});

test("each printer failure has its own sentence in both languages", () => {
  const codes: PrinterErrorCode[] = ["no_credit", "not_confirmed", "disconnected", "write_failed", "cancelled", "connect_failed"];
  const seen = new Set<string>();
  for (const code of codes) {
    const en = printerErrorText(code, "en");
    const fr = printerErrorText(code, "fr");
    assert.ok(en.length > 20 && fr.length > 20 && en !== fr, code);
    seen.add(en);
  }
  assert.equal(seen.size, codes.length, "no two failures share a sentence");
});

test("a batch that stopped part-way says how many had printed; other errors are not the printer's", () => {
  const stopped = new PrinterError("not_confirmed", "x");
  stopped.printed = 2;
  const en = printerFailureText(stopped, 5, "en")!;
  assert.match(en, /^2 of 5 labels printed before it stopped\. /);
  assert.match(printerFailureText(stopped, 5, "fr")!, /^2 étiquettes sur 5 imprimées avant l’arrêt\. /);
  assert.equal(printerFailureText(new PrinterError("disconnected", "x"), 5, "en"), printerErrorText("disconnected", "en"));
  assert.equal(printerFailureText(new Error("boom"), 5, "en"), null);
  assert.equal(printerFailureText("string", 5, "en"), null);
});

test("a failure is announced as an alert; progress as a status", () => {
  assert.equal(labelPrinterStatusRole({ phase: "failed", message: "x" }), "alert");
  assert.equal(labelPrinterStatusRole({ phase: "connecting" }), "status");
  assert.equal(labelPrinterStatusRole({ phase: "done", count: 1 }), "status");
});

// --- the dialog and its hook -------------------------------------------------

const dialogSource = read("../components/business/container-labels-dialog.tsx");
const hookSource = read("../components/business/use-label-printer.ts");
const printerSource = read("./pm241-printer.ts");

test("every static string of the label printer section has French and round-trips", () => {
  const strings = [
    "Label printer",
    "Print on label printer",
    "Printing...",
    "Prints straight to the PM-241 label printer over Bluetooth: one label per piece, with no print window.",
    "Use Chrome to print straight to the label printer, or the Laawol app on iPhone.",
  ];
  for (const english of strings) {
    assert.ok(dialogSource.includes(english), `"${english}" is no longer in the labels dialog`);
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});

test("the labels dialog offers the label printer beside Open labels, and keeps the print window path", () => {
  assert.match(dialogSource, /import \{ useLabelPrinter \} from "@\/components\/business\/use-label-printer";/);
  assert.match(dialogSource, /\{printer\.supported && \(\s*<button className="lst-btn" type="button" disabled=\{busy \|\| printer\.busy\} aria-busy=\{printer\.busy\} onClick=\{\(\) => void printer\.print\(\)\}>/);
  const printerAt = dialogSource.indexOf("void printer.print()");
  const openAt = dialogSource.indexOf("void printLabels()");
  assert.ok(printerAt > 0 && openAt > printerAt, "the label printer comes before Open labels");
  assert.match(dialogSource, /\{busy \? "Opening\.\.\." : "Open labels"\}/);
  // Without Web Bluetooth the dialog says what to use instead and offers no dead button.
  assert.match(dialogSource, /printer\.supported \? \([\s\S]*Prints straight to the PM-241[\s\S]*\) : \([\s\S]*Use Chrome to print straight to the label printer/);
  // The progress sentence carries counts: built per language, never run through the dictionary.
  assert.match(dialogSource, /role=\{labelPrinterStatusRole\(printer\.state\)\}\s+data-no-translate/);
});

test("the dialog asks the label printer for one label per piece", () => {
  assert.match(hookSource, /copies: PACKAGE_LABEL_COPIES_PRINTER,/);
  assert.match(hookSource, /httpsCallable\(functions, "getPackageLabels", \{ timeout: LABELS_TIMEOUT_MS \}\)/);
  assert.match(dialogSource, /lineId: labelsContainerId \? labelsLineId : "",\s+lineIds: waitingIds,/);
});

test("the click's gesture reaches the Bluetooth chooser, and every path ends not busy", () => {
  const body = /const print = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/.exec(hookSource);
  assert.ok(body, "print not found");
  const connectAt = body[1].indexOf("await connectLabelPrinter()");
  const firstAwait = body[1].indexOf("await ");
  assert.ok(connectAt >= 0 && connectAt === firstAwait, "the printer is connected before any other await");
  assert.match(body[1], /\} finally \{\s*running\.current = false;\s*\}/);
  assert.match(body[1], /if \(running\.current\) return;/, "a second tap while printing does nothing");
  // Every catch lands in a terminal state.
  assert.match(body[1], /setState\(\{ phase: "cancelled" \}\)/);
  assert.match(body[1], /phase: "failed"/);
});

test("Web Bluetooth is feature-detected and the recipe's identifiers are used", () => {
  assert.match(printerSource, /\(nav as \(Navigator & \{ bluetooth\?: BtApi \}\) \| undefined\)\?\.bluetooth/);
  assert.match(printerSource, /typeof api\.requestDevice === "function"/);
  assert.match(printerSource, /filters: PM241_NAME_PREFIXES\.map\(\(namePrefix\) => \(\{ namePrefix \}\)\)/);
  assert.match(printerSource, /optionalServices: \[PM241_SERVICE_SHORT\]/);
  assert.match(printerSource, /api\.getDevices/);
  assert.match(printerSource, /writeValueWithoutResponse/);
  assert.match(printerSource, /gattserverdisconnected/);
  // Asked once, when the dialog mounts (it never renders in the static export).
  assert.match(hookSource, /useState\(\(\) => labelPrinterSupported\(\)\)/);
});
