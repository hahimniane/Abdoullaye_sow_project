import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVOICE_PAYMENT_METHOD_LABELS } from "./invoice-ledger.ts";
import { PACKAGE_PAYMENT_LABELS, WAITING_PACKAGE_FIELD_ORDER } from "./waiting-packages.ts";
import { CONTAINER_MESSAGES, LINE_STAGE_LABELS } from "./container-manifest.ts";

// The console wiring the waiting-packages feature depends on, pinned by
// reading the source the way containers-console-contract.test.ts does, plus a
// scan that every sentence the new screens show has its French: the guardrail
// is "a string only in English is a bug", and a screen's JSX is where it is
// easiest to forget one.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panelPath = "../components/business/waiting-packages-panel.tsx";
const paymentPath = "../components/business/package-payment-dialog.tsx";
const assignPath = "../components/business/add-waiting-packages-dialog.tsx";
const piecesPath = "../components/business/pieces-editor.tsx";
const guestPath = "../components/guest-tracking.tsx";
const containersPath = "../components/business/containers-panel.tsx";
const operationsPath = "../components/business/operations-panels.tsx";
const panelSource = read(panelPath);
const paymentSource = read(paymentPath);
const assignSource = read(assignPath);
const piecesSource = read(piecesPath);
const guestSource = read(guestPath);
const containersSource = read(containersPath);
const operationsSource = read(operationsPath);
const staffViewSource = read("../components/package-staff-view.tsx");
const labelsSource = read("../components/business/container-labels-dialog.tsx");
const businessDataSource = read("./business-data.ts");

// ---------------------------------------------------------------------------
// Every string on the new screens is in the French dictionary.
// ---------------------------------------------------------------------------

/** Spelled the same in French, or not words at all (units, symbols). */
const SAME_IN_FRENCH = new Set(["Description", "Destination", "VIN", "Total", "ft³"]);

const ATTRIBUTES_WITH_COPY = new Set(["placeholder", "title", "aria-label", "label", "alt"]);
/** Functions whose string arguments end up on screen. */
const SPEAKING_CALLS = new Set(["onFlash", "setError", "setDraftError", "setFlash"]);

/** The English a file shows: JSX text, copy attributes, and the messages its handlers raise. */
function screenStrings(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]{2}/.test(value)) found.add(value);
  };
  /** Literals a value expression can evaluate to: either branch of a ?:, the right side of && and ||. */
  const literalsOf = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isParenthesizedExpression(node)) literalsOf(node.expression);
    else if (ts.isConditionalExpression(node)) { literalsOf(node.whenTrue); literalsOf(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) { literalsOf(node.right); }
  };
  const optedOut = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      const attrs = ts.isJsxElement(at) ? at.openingElement.attributes : ts.isJsxSelfClosingElement(at) ? at.attributes : null;
      if (attrs?.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-no-translate")) return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !optedOut(node)) add(node.getText().replace(/&amp;/g, "&").replace(/&apos;/g, "'"));
    if (ts.isJsxAttribute(node) && ATTRIBUTES_WITH_COPY.has(node.name.getText()) && !optedOut(node)) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
      else if (init && ts.isJsxExpression(init)) literalsOf(init.expression);
    }
    if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent) && !optedOut(node)) literalsOf(node.expression);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (SPEAKING_CALLS.has(callee)) node.arguments.forEach(literalsOf);
      if (callee === "runPanelAction") literalsOf(node.arguments[2]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => {
    if (SAME_IN_FRENCH.has(english)) return false;
    return !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS);
  });
}

for (const [name, source, path] of [
  ["the waiting packages list and form", panelSource, panelPath],
  ["the package payment dialog", paymentSource, paymentPath],
  ["the add-waiting-packages dialog", assignSource, assignPath],
  ["the pieces editor", piecesSource, piecesPath],
] as const) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(source, path);
    assert.ok(strings.length > 5, "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

test("the payment dialog asks who took the money exactly like parking does", () => {
  // A required select, blank by default, fed the business's people.
  assert.match(paymentSource, /<span>Received by<\/span>[\s\S]*?<option value="">Choose staff<\/option>[\s\S]*?staffOptions\.map/);
  assert.match(paymentSource, /receivedByStaffId: e\.target\.value/);
  assert.match(paymentSource, /staffOptions: readonly \{ id: string; name: string \}\[\]/);
  // The history says who held it and, when someone else typed it in, who did.
  assert.match(paymentSource, /<span>Received by<\/span> <span data-no-translate>\{received\}/);
  assert.match(paymentSource, /<span>entered by<\/span> <span data-no-translate>\{entered\}/);
  assert.match(paymentSource, /entry\.recordedByStaffId !== entry\.receivedByStaffId/);
  // The list panel passes the staff list on, built once from the staff index.
  assert.match(panelSource, /staffOptions=\{staffOptions\}/);
  assert.match(containersSource, /staffOptionsFrom\(staffNames\)/);
  assert.match(containersSource, /staffOptions=\{staffOptions\}/);
  for (const english of ["Received by", "Choose staff", "entered by", "Say which staff member took the payment."]) {
    assert.ok(english in TEXT_TRANSLATIONS || english in ATTRIBUTE_TRANSLATIONS, english);
  }
});

test("the sentences the pure modules build for the new screens have their French", () => {
  const strings: string[] = [
    ...Object.values(CONTAINER_MESSAGES),
    ...Object.values(PACKAGE_PAYMENT_LABELS),
    ...Object.values(LINE_STAGE_LABELS),
    ...Object.values(INVOICE_PAYMENT_METHOD_LABELS),
  ];
  const missing = strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !SAME_IN_FRENCH.has(english));
  assert.deepEqual(missing, []);
  // And the words really change, rather than the key mapping to itself.
  for (const english of Object.values(CONTAINER_MESSAGES)) {
    assert.notEqual(translateValue(english, "fr"), english);
  }
});

test("the strings the other screens gained for waiting packages have their French", () => {
  const strings = [
    // package-staff-view.tsx
    "Size and price", "Package size", "Price", "Paid", "Still owed", "Payment", "Waiting for a container",
    // containers-panel.tsx
    "Waiting list", "Add waiting packages", "Send back to waiting", "Package sent back to waiting.", "Container lists",
    // operations-panels.tsx
    "Main destination", "Make main", "Main destination saved.", "Main destination cleared.", "New packages open on this country",
    // container-labels-dialog.tsx
    "A QR code, tracking code and both phone numbers for each of the selected packages.",
    "— a QR code, tracking code and both phone numbers.",
  ];
  assert.deepEqual(strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS)), []);
  for (const source of [staffViewSource, containersSource, operationsSource, labelsSource]) {
    assert.ok(source.length > 0);
  }
});

// ---------------------------------------------------------------------------
// The wiring.
// ---------------------------------------------------------------------------

test("waiting packages are read live from containerLines by business and waiting state, through one hook", () => {
  assert.match(
    businessDataSource,
    /export function useWaitingPackages\(businessId: string, enabled: boolean\): BusinessRowsResult \{\s*return useBusinessCollection\("containerLines", businessId, enabled, \{\s*pageSize: null,\s*where: \[\["containerStatus", "==", "waiting"\]\],/,
  );
  // The panel subscribes through the hook and never queries containerLines itself.
  assert.match(containersSource, /const waiting = useWaitingPackages\(businessId, enabled\);/);
  assert.doesNotMatch(containersSource, /useBusinessCollection\("containerLines"/);
  // Payments are read by business and line - the root's, for a package split
  // across containers (payments live on the root; the server routes a part's).
  assert.match(paymentSource, /const paymentsLineId = group\.rootLineId \|\| groupRootId\(line, lineId\);/);
  assert.match(paymentSource, /useBusinessCollection\("containerLinePayments", businessId, Boolean\(paymentsLineId\), \{\s*pageSize: null,\s*where: \[\["lineId", "==", paymentsLineId\]\],/);
  // ...and recorded with the line's own id.
  assert.match(paymentSource, /recordPackagePaymentRequest\(businessId, lineId, draft\)/);
});

test("every callable the waiting screens use is called through httpsCallable, and nothing is client-written", () => {
  for (const [callable, source] of [
    ["addWaitingPackage", panelSource],
    ["updateContainerLine", panelSource],
    ["setContainerLinePrice", panelSource],
    ["removeContainerLine", panelSource],
    ["assignContainerLines", assignSource],
    ["recordContainerLinePayment", paymentSource],
    ["revertContainerLinePayment", paymentSource],
    ["setContainerLinePrice", paymentSource],
    ["unassignContainerLine", containersSource],
  ] as const) {
    assert.match(source, new RegExp(`httpsCallable\\(functions, "${callable}"\\)`), `${callable} is not called`);
  }
  for (const source of [panelSource, paymentSource, assignSource]) {
    assert.doesNotMatch(source, /\b(setDoc|updateDoc|addDoc|deleteDoc)\(/);
  }
});

test("the containers panel keeps its props and adds the Waiting list beside the containers", () => {
  assert.match(containersSource, /type ContainersPanelProps = \{\s*businessId: string;/);
  assert.match(containersSource, /\) : view === "waiting" \? \(\s*<WaitingPackagesPanel/);
  assert.match(containersSource, /searchContainerLines\(\[\.\.\.lines\.rows, \.\.\.waiting\.rows\], containers\.rows, search\)/);
  assert.match(containersSource, /<AddWaitingPackagesDialog/);
  assert.match(containersSource, /httpsCallable\(functions, "unassignContainerLine"\)\(\{ businessId, lineId: String\(row\.id\) \}\)/);
  // Adding and sending back are for a container that is still loading.
  assert.match(containersSource, /\{selectedOpen && \(\s*<span className="panel-action">\s*<button className="lst-btn ghost" type="button" disabled=\{busy \|\| waiting\.rows\.length === 0\} onClick=\{\(\) => setModal\("assign"\)\}>/);
});

test("the register form's primary action prints one label per piece; Save & add another keeps the sender", () => {
  assert.match(panelSource, /void save\("another"\)\}>Save &amp; add another<\/button>/);
  assert.match(panelSource, /void save\("save"\)\}>Save without printing<\/button>/);
  // "Save and print 3 labels": built per language, the count is the pieces.
  assert.match(panelSource, /<button className="lst-add" type="button" disabled=\{busy\} aria-busy=\{busy\} onClick=\{\(\) => void save\("print"\)\}>/);
  assert.match(panelSource, /savePrintLabelsText\(labelCount, lang\)/);
  assert.match(panelSource, /const labelCount = waitingDraftLabelCount\(draft\);/);
  assert.match(panelSource, /setDraft\(nextPackageForSameSender\(draft, defaultDestination\)\)/);
  // The destination opens on the main destination.
  assert.match(panelSource, /emptyWaitingPackageDraft\(defaultDestination\)/);
  assert.match(containersSource, /defaultWaitingDestination\(destinations\.rows\)/);
});

test("the register form's 'Money received now?' asks what the payment dialog asks, from the same lists", () => {
  // Only on a new package, only once a price is entered.
  assert.match(panelSource, /\{!editingId && \(\s*<div className="wpk-intake-money">/);
  assert.match(panelSource, /disabled=\{busy \|\| \(!draft\.money\.received && !moneyAvailable\)\}/);
  assert.match(panelSource, /switchIntakeMoney\(d, e\.target\.checked\)/);
  // The same method list and labels, the same people, nobody chosen by default.
  assert.match(panelSource, /INVOICE_PAYMENT_METHODS\.map\(\(m\) => \(<option key=\{m\} value=\{m\}>\{INVOICE_PAYMENT_METHOD_LABELS\[m\]\}<\/option>\)\)/);
  assert.match(panelSource, /<span>Received by<\/span>[\s\S]*?<option value="">Choose staff<\/option>[\s\S]*?staffOptions\.map/);
  assert.match(paymentSource, /INVOICE_PAYMENT_METHODS\.map\(\(m\) => \(<option key=\{m\} value=\{m\}>\{INVOICE_PAYMENT_METHOD_LABELS\[m\]\}<\/option>\)\)/);
  // Checked against the people offered, sent with the package, cleared for the next one.
  assert.match(panelSource, /validateWaitingPackage\(draft, staffIds, editingRow\)/);
  assert.match(panelSource, /addWaitingPackagePayload\(businessId, draft\)/);
  assert.match(panelSource, /setDraft\(nextPackageForSameSender\(draft, defaultDestination\)\)/);
});

test("the customer's and receiver's phones use the shared picker through ContactPhone", () => {
  assert.match(panelSource, /import \{ ContactPhone, SenderIsReceiverBox \} from "@\/components\/business\/contact-phone";/);
  assert.equal((panelSource.match(/<ContactPhone\b/g) ?? []).length, 2);
  // "Sender is the receiver" hides the sender's fields (owner, 2026-10-21);
  // the receiver's name is a field the refusal can focus.
  assert.match(panelSource, /<SenderIsReceiverBox checked=\{draft\.senderIsReceiver\}[\s\S]{0,240}?withSenderIsReceiver\(d, on\)/);
  assert.match(panelSource, /\{!draft\.senderIsReceiver && \(\s*<div className="lst-form-grid">/);
  assert.match(panelSource, /<input id="wpk-receiver-name" \{\.\.\.invalidProps\("wpk-receiver-name"\)\}/);
  assert.doesNotMatch(panelSource, /<input[^>]*value=\{[^}]*(customerPhone|receiverPhone)\}/);
});

test("the labels dialog prints waiting packages by line id, with no container", () => {
  assert.match(labelsSource, /container = null,/);
  assert.match(labelsSource, /containerLabelsRequest\(businessId, labelsContainerId, labelChoice, labelsContainerId \? labelsLineId : waitingIds\)/);
  assert.match(panelSource, /<ContainerLabelsDialog\s+businessId=\{businessId\}\s+lines=\{labelLines\}/);
});

test("a package with no container reads 'Waiting for a container', never 'Container not found'", () => {
  assert.match(staffViewSource, /\{view\.waiting \? \(\s*<div className="pur-info">\s*<div><span>Container<\/span><b>Waiting for a container<\/b><\/div>/);
  assert.match(staffViewSource, /disabled=\{!containerRow && !view\.waiting\}/);
});

test("the destinations list sets the main destination through the server, one at a time", () => {
  assert.match(operationsSource, /const changes = mainDestinationChanges\(destinations\.rows, row\.isMain === true \? "" : row\.id\);/);
  assert.match(operationsSource, /httpsCallable\(functions, "setMainDestination"\)\(\{ businessId, countryId: row\.isMain === true \? "" : row\.id \}\)/);
});

test("a refused save brings the first bad field into view, and refusals sit beside the buttons", () => {
  // Regression: the refusal rendered at the top of a scrolled modal, so Save looked dead.
  assert.match(panelSource, /const field = firstInvalidWaitingPackageField\(errors\);\s*if \(field\) window\.requestAnimationFrame\(\(\) => revealField\(document\.getElementById\(field\)\)\);/);
  // Every field the helper can name is an element id the form renders.
  for (const field of WAITING_PACKAGE_FIELD_ORDER) {
    if (field === "wpk-customer-phone" || field === "wpk-receiver-phone") {
      assert.match(panelSource, new RegExp(`<ContactPhone\\s+id="${field}"`));
    } else if (field === "wpk-pieces") {
      // The pieces editor shows each piece's own problem under that piece.
      assert.match(panelSource, /<PiecesEditor\s+id="wpk-pieces"[\s\S]*?showErrors=\{triedSave\}/);
    } else {
      assert.match(panelSource, new RegExp(`id="${field}" \\{\\.\\.\\.invalidProps\\("${field}"\\)\\}`), field);
    }
  }
  // "Received by" shows its own sentence under it.
  assert.match(panelSource, /<select id="wpk-received-by"[\s\S]*?<\/select>\s*\{fieldErrorNote\("wpk-received-by"\)\}/);
  // The refusal and "Added so far" live in the footer (which never scrolls), not the body.
  const footer = panelSource.slice(panelSource.indexOf('<footer className="lst-modal-foot wpk-foot">'));
  const body = panelSource.slice(panelSource.indexOf('<div className="lst-modal-body">'), panelSource.indexOf('<footer className="lst-modal-foot wpk-foot">'));
  assert.match(footer, /\{draftError && <div className="lst-form-error wpk-foot-note" role="alert">\{draftError\}<\/div>\}/);
  assert.match(footer, /role="status" aria-live="polite">Added so far:/);
  assert.doesNotMatch(body, /draftError &&|Added so far/);
});

test("one pieces editor serves the register form, the waiting edit and the containers panel's line form", () => {
  for (const [source, id] of [[panelSource, "wpk-pieces"], [containersSource, "ctn-pieces"]] as const) {
    assert.match(source, /import \{ PiecesEditor \} from "@\/components\/business\/pieces-editor";/);
    assert.equal((source.match(/<PiecesEditor\b/g) ?? []).length, 1, "one editor per form, not a fork");
    assert.match(source, new RegExp(`<PiecesEditor\\s+id="${id}"`));
  }
  // The editor is thin over the pure helpers; it holds no rule of its own.
  for (const helper of ["pieceDraftProblems", "piecesDraftTotalCents", "addPieceDraft", "removePieceDraft", "updatePieceDraft"]) {
    assert.match(piecesSource, new RegExp(`\\b${helper}\\(`), helper);
  }
  assert.doesNotMatch(piecesSource, /readMoneyInput\(|pieceErrors\(/);
  // Its money placeholder follows the language, like the register form's.
  assert.match(piecesSource, /const moneyPlaceholder = lang === "fr" \? "0,00" : "0\.00";/);
  // A car is never pieces: the editor shows for every other kind.
  assert.match(panelSource, /\{piecesMode && \(\s*<PiecesEditor/);
  assert.match(containersSource, /\{lineDraftHasPieces\(lineDraft\) && \(\s*<PiecesEditor/);
});

test("an edit sends piece prices with the pieces, and setContainerLinePrice only for a car or the switch", () => {
  assert.match(panelSource, /updateWaitingPackageRequest\(businessId, editingId, draft, line\)/);
  assert.match(panelSource, /const priceRequest = line \? editPriceRequest\(businessId, editingId, line, draft\) : null;\s*if \(priceRequest\) await httpsCallable\(functions, "setContainerLinePrice"\)\(priceRequest\);/);
  // The payment dialog sends a package's total back unchanged: only the switch moves.
  assert.match(paymentSource, /setContainerLinePrice"\)\(\{ businessId, lineId, priceCents: own\.priceCents, payOnArrival \}\)/);
});

test("group money is computed once in the containers panel and handed down, never per row", () => {
  assert.match(containersSource, /const lineGroups = useMemo\(\(\) => buildLineGroups\(\[\.\.\.lines\.rows, \.\.\.waiting\.rows\]\), \[lines\.rows, waiting\.rows\]\);/);
  assert.match(containersSource, /groups=\{lineGroups\}/);
  assert.match(containersSource, /<PackageMoney line=\{row\} group=\{groupForLine\(lineGroups, row\)\} lang=\{lang\} \/>/);
  assert.match(panelSource, /const group = groupForLine\(groups, row\);\s*const payment = groupPayment\(group\);/);
  assert.match(panelSource, /group=\{paymentGroup\}/);
  for (const source of [panelSource, containersSource, paymentSource]) {
    assert.doesNotMatch(source, /buildLineGroups\([^)]*\)\s*\.get|lineGroupSummary\(/, "no group built inside a row");
  }
});

test("the split stepper sends pieceCounts and offers the new labels for the pieces that stay", () => {
  assert.match(assignSource, /assignLinesRequest\(businessId, text\(container\.id, ""\), selected, going, packages\)/);
  assert.match(assignSource, /const answer = assignAnswerFrom\(response\.data\);/);
  assert.match(assignSource, /piecesGoingText\(goes, total, lang\)/);
  assert.match(assignSource, /splitPreviewRows\(line, goes, packages, lang\)/);
  assert.match(assignSource, /Print labels for the pieces that stay/);
  // The parts' labels print through the waiting-package path: by line id, no container.
  assert.match(assignSource, /<ContainerLabelsDialog businessId=\{businessId\} lines=\{partLabelStubs\(parts\)\} onClose=\{onClose\} \/>/);
  // A car is never split; the stepper shows only for a ticked package with several pieces.
  assert.match(assignSource, /\{ticked && total > 1 && \(/);
});

test("the public tracking page shows a split package's parts and the group's money, in both languages", () => {
  // Parsed defensively in guest-tracking.ts; rendered only when present.
  assert.match(guestSource, /\{record\.parts && record\.parts\.length > 1 && \(/);
  assert.match(guestSource, /\{record\.payment && \(/);
  assert.match(guestSource, /guestStageLabel\(record\.service, part\.stage\)/);
  for (const english of [
    "This shipment travels in parts",
    "Each part has its own code and its own updates.",
    "Payment",
    "Final price",
    "Paid",
    "Balance",
    "For your privacy, only the shipment status, its payment and shipping details are shown here.",
  ]) {
    assert.ok(guestSource.includes(english), english);
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("the price and amount placeholders use a decimal comma in French", () => {
  assert.match(panelSource, /const moneyPlaceholder = lang === "fr" \? "0,00" : "0\.00";/);
  assert.equal((panelSource.match(/placeholder=\{moneyPlaceholder\}/g) ?? []).length, 2);
  assert.doesNotMatch(panelSource, /placeholder="0\.00"/);
});

test("the destinations page lists only the countries in use; Add country brings others in", () => {
  assert.match(operationsSource, /import \{ destinationIsInUse \} from "@\/lib\/destination-visibility";/);
  assert.match(operationsSource, /\.filter\(\(row\) => destinationIsInUse\(/);
  assert.doesNotMatch(operationsSource, /showAllCountries/);
});
