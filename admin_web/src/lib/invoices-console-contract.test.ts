import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";
import { businessSidebarTabs } from "./business-sidebar.ts";

// Invoices are hand-written papers for anything the business sold. These
// tests pin the console wiring the feature depends on - the tab, its
// permission, the panel route, the callables it writes through, the PDF and
// text hand-offs - by reading the source, so a refactor that drops one fails
// here rather than in front of a business owner.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const consoleSource = read("../components/business-console.tsx");
const panelSource = read("../components/business/invoices-panel.tsx");
const backendSource = read("../../../my_flutter_app/functions/index.js");
const rulesSource = read("../../../my_flutter_app/firestore.rules");

test("the Invoices tab sits under Manage, gated by the ledger permission and no service", () => {
  const tab = businessSidebarTabs.find((entry) => entry.id === "invoices");
  assert.ok(tab, "no invoices tab");
  assert.equal(tab.label, "Invoices");
  assert.equal(tab.group, "manage");
  assert.equal(tab.permission, "ledger");
  assert.equal(tab.service, undefined, "an invoice is not tied to a sold service");
});

test("the console routes the tab to InvoicesPanel with the business identity", () => {
  assert.match(consoleSource, /import \{InvoicesPanel\} from "@\/components\/business\/invoices-panel";/);
  assert.match(consoleSource, /\{activeTab === "invoices" && \(\s*<InvoicesPanel[\s\S]*?business=\{business\}[\s\S]*?\/>\s*\)\}/);
  assert.match(consoleSource, /invoices: <Receipt \{\.\.\.props\} \/>,/, "the sidebar icon map must cover the tab");
});

test("the panel reads the three collections by business and writes only through callables", () => {
  for (const name of ["invoices", "invoiceLines", "invoicePayments"]) {
    assert.match(panelSource, new RegExp(`useBusinessCollection\\("${name}", businessId, enabled, \\d+\\)`));
    assert.match(rulesSource, new RegExp(`match /${name}/\\{[a-zA-Z]+\\} \\{\\s*allow read: if lotLedgerRead\\(resource\\.data\\.businessId\\);\\s*allow write: if false;`),
      `${name} must be readable by the business and written only by callables`);
  }
  for (const callable of [
    "createInvoice", "updateInvoice", "deleteInvoice",
    "addInvoiceLine", "updateInvoiceLine", "removeInvoiceLine",
    "recordInvoicePayment", "revertInvoicePayment",
  ]) {
    assert.match(panelSource, new RegExp(`httpsCallable\\(functions, "${callable}"\\)`), `panel never calls ${callable}`);
    assert.match(backendSource, new RegExp(`exports\\.${callable} = onCall\\(`), `backend lacks ${callable}`);
  }
  assert.doesNotMatch(panelSource, /setDoc\(|updateDoc\(|addDoc\(|deleteDoc\(/, "no client-side writes");
  // Every invoice callable is gated on the ledger permission.
  assert.match(backendSource, /const INVOICE_SECTION = "ledger";/);
});

test("the paper leaves as a PDF file or as WhatsApp text, never a raw page", () => {
  assert.match(panelSource, /buildInvoicePdf\(/);
  assert.match(panelSource, /deliverPdf\(/);
  assert.match(panelSource, /invoiceTextSummary\(/);
  assert.match(panelSource, /navigator\.clipboard\.writeText\(textPreview\)/);
});

test("every string the panel shows has a French reading", () => {
  for (const english of [
    "Invoices & receipts", "New invoice", "Open invoice", "Record a payment", "Save as PDF",
    "Copy as text", "Pay the whole balance", "Save & add another", "Balance due", "Owed to you",
    "No invoices yet. Open one the next time you sell something.",
    "Give the invoice a short title (what it is for).",
    "That is more than what is still owed.",
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
