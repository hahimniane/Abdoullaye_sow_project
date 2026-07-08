// Regression tests for the French DOM translation engine.
//
// Context: a previous version translated each text node by running a ~600-key
// `replaceAll` reduce, and its MutationObserver reacted to its own writes. On
// the full admin console this pegged the main thread and the page never loaded.
// These tests lock in the two properties whose violation caused that incident:
//
//   1. Idempotency  — translating an already-translated string must reach a
//      fixpoint in one step. If f(f(x)) !== f(x), the observer can keep
//      rewriting the same node forever.
//   2. Performance  — translating realistic text must stay well under a small
//      time budget, so we never reintroduce per-node O(dictionary) work.
//
// Run with:  npm test   (Node's built-in runner; no extra dependencies)

import assert from "node:assert/strict";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, resolveLang, translateValue } from "./french-dom.ts";

const entries = Object.entries(TEXT_TRANSLATIONS);

// Repeatedly apply translation until it stops changing. The property that
// actually prevents the freeze is *convergence*: translation must reach a
// fixpoint in a few steps and must never grow the string without bound. (The
// runtime observer is also guarded against re-entrancy, so a single extra pass
// is harmless — divergence is the failure mode we must forbid.)
function convergenceSteps(value: string, lang: string, max = 12) {
  let current = value;
  for (let step = 1; step <= max; step += 1) {
    const next = translateValue(current, lang);
    if (next === current) return { steps: step - 1, value: current, converged: true };
    if (next.length > value.length * 4) {
      return { steps: step, value: next, converged: false };
    }
    current = next;
  }
  return { steps: max, value: current, converged: false };
}

test("forward translation converges quickly and never diverges", () => {
  const offenders: string[] = [];
  for (const [english] of entries) {
    const result = convergenceSteps(english, "fr");
    if (!result.converged || result.steps > 3) offenders.push(`${english} (steps=${result.steps})`);
  }
  assert.equal(
    offenders.length,
    0,
    `These keys do not converge within 3 fr passes (re-translation risk):\n` +
      offenders.slice(0, 20).join("\n"),
  );
});

test("reverse translation converges quickly and never diverges", () => {
  const offenders: string[] = [];
  for (const [, french] of entries) {
    const result = convergenceSteps(french, "en");
    if (!result.converged || result.steps > 3) offenders.push(`${french} (steps=${result.steps})`);
  }
  assert.equal(offenders.length, 0, offenders.slice(0, 20).join("\n"));
});

test("exact dictionary entries translate to their French value", () => {
  for (const [english, french] of entries) {
    assert.equal(translateValue(english, "fr"), french);
  }
});

test("translation does not rewrite identifier-like values", () => {
  assert.equal(
    translateValue("acct_atlantic_pending", "fr"),
    "acct_atlantic_pending",
  );
  assert.equal(
    translateValue("business_status_pending", "fr"),
    "business_status_pending",
  );
  assert.equal(
    translateValue("2 Stripe requirements due", "fr"),
    "2 exigences Stripe requises",
  );
  assert.equal(
    translateValue("Business changes requested (preview only)", "fr"),
    "Modifications demandées à l’entreprise (aperçu uniquement)",
  );
});

test("language resolves from a saved preference first, then the device", () => {
  // Saved choice always wins, regardless of device language.
  assert.equal(resolveLang("en", ["fr-FR"]), "en");
  assert.equal(resolveLang("fr", ["en-US"]), "fr");

  // No saved choice: follow the primary device language.
  assert.equal(resolveLang(null, ["fr-FR", "en-US"]), "fr");
  assert.equal(resolveLang(null, ["fr"]), "fr");
  assert.equal(resolveLang(null, ["en-US", "fr-FR"]), "en");

  // No saved choice, unsupported/non-French device -> base English content.
  assert.equal(resolveLang(null, ["en-US"]), "en");
  assert.equal(resolveLang(null, ["es-ES", "de-DE"]), "en");
  assert.equal(resolveLang(null, ["es-ES", "fr-FR"]), "en");

  // No saved choice and no device info -> English.
  assert.equal(resolveLang(null, []), "en");

  // Garbage saved value is ignored and we fall back to the device.
  assert.equal(resolveLang("xx", ["fr-FR"]), "fr");
});

test("translating a large realistic payload stays within the time budget", () => {
  // ~2k text fragments, the order of magnitude of the full admin DOM. The old
  // O(dictionary) reduce blew far past this; the precompiled regex must not.
  const sample = entries.map(([english]) => english);
  const blobs: string[] = [];
  for (let i = 0; i < 2000; i += 1) {
    blobs.push(sample[i % sample.length]);
  }

  const start = performance.now();
  for (const blob of blobs) translateValue(blob, "fr");
  const elapsedMs = performance.now() - start;

  assert.ok(
    elapsedMs < 250,
    `Translating ${blobs.length} fragments took ${elapsedMs.toFixed(1)}ms ` +
      `(budget 250ms). A regression here means per-node translation cost has ` +
      `grown — the class of bug that froze the admin console.`,
  );
});
