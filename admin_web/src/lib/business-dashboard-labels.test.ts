import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";

const consoleSource = readFileSync(
  "src/components/business-console.tsx",
  "utf8",
);

test("every dashboard status label is a full dictionary key", () => {
  // The dashboard's fallback Title-Cases unknown statuses, which misses the
  // dictionary's exact-match pass and lets the substring pass translate the
  // words it happens to know: a business owner read
  // "Awaiting Poids Confirmation" on their work list.
  for (const label of [
    "Awaiting weight confirmation",
    "Awaiting balance payment",
    "Pending payment",
    "Ready for pickup",
    "Settlement processing",
  ]) {
    assert.match(
      consoleSource,
      new RegExp(`"${label}"`),
      `statusLabel must emit "${label}" verbatim`,
    );
    const french = translateValue(label, "fr");
    assert.notEqual(french, label, `no French for "${label}"`);
    assert.doesNotMatch(
      french,
      /[A-Z][a-z]+ [A-Z]/,
      `"${french}" looks like untranslated Title Case`,
    );
  }
});

test("the whole-order cancel tooltip translates as one sentence", () => {
  const english =
    "This shipment was paid with its order, so the whole order is cancelled";
  const french = translateValue(english, "fr");
  assert.notEqual(french, english);
  // The failure mode was word-level substitution leaving a hybrid:
  // "This expédition was paid with its order, so the whole order is annulé".
  assert.doesNotMatch(french, /\b(This|was|paid|with|order|the)\b/);
});

test("a work-list row opens the queue that can act on it", () => {
  // The rows named shipments but tapping one went nowhere, so the owner had
  // to find the same record a second time in the service queue.
  assert.match(consoleSource, /onOpenTab=\{setActiveTab\}/);
  assert.match(consoleSource, /onOpen=\{\(\) => onOpenTab\(tab\)\}/);
  assert.match(consoleSource, /tab: "freight" as BusinessTab/);
  assert.match(consoleSource, /tab: "barrels" as BusinessTab/);
});

test("a guest's price request confirms on screen, with its code", () => {
  // A guest's request subscription is auth-gated, so their successful send
  // rendered nothing: the cleared form read as "nothing happened" and a
  // retry created a real duplicate (FQ-QD4Y5J / FQ-28R9KR).
  const shipping = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  assert.match(shipping, /rememberSentQuoteRequest\(confirmation\)/);
  assert.match(shipping, /sent && !\(authenticated && activeRequest\)/);
  assert.match(shipping, /Your price request was sent\./);
  // The confirmation must survive the remount that starting a guest
  // session causes mid-submit.
  assert.match(shipping, /useState<\{\s*trackingCode: string;/);
  assert.match(shipping, /readSentQuoteRequest/);
  assert.match(shipping, /sessionStorage\.getItem\(SENT_QUOTE_REQUEST_KEY\)/);
});

test("the sent confirmation copy is localized in French", () => {
  for (const english of [
    "Your price request was sent.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
  }
});
