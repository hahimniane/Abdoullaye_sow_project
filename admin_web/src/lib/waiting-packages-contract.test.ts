import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVOICE_PAYMENT_METHOD_LABELS } from "./invoice-ledger.ts";
import { PACKAGE_PAYMENT_LABELS } from "./waiting-packages.ts";
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
const containersPath = "../components/business/containers-panel.tsx";
const operationsPath = "../components/business/operations-panels.tsx";
const panelSource = read(panelPath);
const paymentSource = read(paymentPath);
const assignSource = read(assignPath);
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
] as const) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(source, path);
    assert.ok(strings.length > 5, "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

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
  // Payments are the line's own, read by business and line.
  assert.match(paymentSource, /useBusinessCollection\("containerLinePayments", businessId, Boolean\(lineId\), \{\s*pageSize: null,\s*where: \[\["lineId", "==", lineId\]\],/);
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

test("the register form offers Save, Save & print label and Save & add another for the same customer", () => {
  assert.match(panelSource, /void save\("another"\)\}>Save &amp; add another for the same customer<\/button>/);
  assert.match(panelSource, /void save\("print"\)\}><Printer size=\{16\} \/> Save &amp; print label<\/button>/);
  assert.match(panelSource, /void save\("save"\)\}/);
  // The destination opens on the main destination.
  assert.match(panelSource, /emptyWaitingPackageDraft\(defaultDestination\)/);
  assert.match(containersSource, /defaultWaitingDestination\(destinations\.rows\)/);
});

test("the customer's and receiver's phones use the shared picker through ContactPhone", () => {
  assert.match(panelSource, /import \{ ContactPhone \} from "@\/components\/business\/contact-phone";/);
  assert.equal((panelSource.match(/<ContactPhone\b/g) ?? []).length, 2);
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
