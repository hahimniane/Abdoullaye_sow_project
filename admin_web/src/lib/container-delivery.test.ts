import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateAuditSummary } from "./audit-summaries.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  DELIVERY_ACTION,
  DELIVERY_NOT_ARRIVED_HINT,
  DELIVERY_PROGRESS_COPY,
  DELIVERY_REFUSAL_COPY,
  DELIVERY_RESULT_COPY,
  DELIVERY_SERVER_REASONS,
  MAX_COLLECTED_BY,
  collectedByError,
  containerDeliveryProgress,
  defaultCollectedBy,
  deliverAnswerFrom,
  deliverRequest,
  deliverResultText,
  deliveredOfText,
  deliveryAccess,
  deliveryBalanceCents,
  deliveryBalanceWarning,
  deliveryCodeFrom,
  deliveryRefusalFrom,
  deliveryRefusalText,
  deliveryStage,
  lineDelivery,
  showsDeliveryProgress,
  undoDeliveryRequest,
  undoResultText,
} from "./container-delivery.ts";
import { PACKAGE_UPDATE_SENTENCE, packageLastUpdate, packageStaffScope } from "./package-staff.ts";
import { screenStrings } from "./screen-strings.ts";
import { buildLineGroups, groupForLine } from "./waiting-packages.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const serverSource = read("../../../my_flutter_app/functions/container_delivery.js");

// ---------------------------------------------------------------------------
// Mirror discipline: the server module is the authority.
// ---------------------------------------------------------------------------

function serverMessages(): Record<string, string> {
  const block = serverSource.match(/const DELIVERY_MESSAGES = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(block, "server DELIVERY_MESSAGES not found");
  const out: Record<string, string> = {};
  for (const [, key, raw] of block![1].matchAll(/(\w+):\s*((?:"[^"]*"\s*\+?\s*)+),/g)) {
    out[key] = [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
  }
  return out;
}

test("every refusal reason the server raises has its sentence, word for word", () => {
  const server = serverMessages();
  assert.ok(Object.keys(server).length >= 5, "expected the full server vocabulary");
  assert.deepEqual([...DELIVERY_SERVER_REASONS].sort(), Object.keys(server).sort());
  for (const [key, sentence] of Object.entries(server)) {
    assert.equal(DELIVERY_REFUSAL_COPY[key as keyof typeof DELIVERY_REFUSAL_COPY], sentence, key);
  }
  // Plus the two the console adds: no permission, and anything else.
  assert.ok(DELIVERY_REFUSAL_COPY.permission_denied);
  assert.ok(DELIVERY_REFUSAL_COPY.unknown);
});

test("the actions, the length limit and the permission rules match the server", () => {
  assert.match(serverSource, /DELIVER: "deliver",\s*UNDO: "undo_delivery",/);
  assert.deepEqual({ ...DELIVERY_ACTION }, { DELIVER: "deliver", UNDO: "undo_delivery" });
  assert.match(serverSource, new RegExp(`const MAX_COLLECTED_BY = ${MAX_COLLECTED_BY};`));
  assert.match(serverSource, /const DELIVERY_SECTIONS = Object\.freeze\(\["containers", DELIVERIES_SECTION\]\);/);
  assert.match(serverSource, /const DELIVERIES_SECTION = "deliveries";/);
  assert.match(serverSource, /const DELIVERY_UNDO_SECTION = "containers";/);
  assert.match(serverSource, /const DELIVERY_MONEY_SECTIONS = Object\.freeze\(\["containers", "ledger"\]\);/);
});

// ---------------------------------------------------------------------------
// Who may do what.
// ---------------------------------------------------------------------------

test("owners and admins may do everything; staff by their permissions", () => {
  const all = { canDeliver: true, canUndo: true, canSeeMoney: true };
  assert.deepEqual(deliveryAccess({ role: "businessOwner" }), all);
  assert.deepEqual(deliveryAccess({ role: "admin" }), all);
  assert.deepEqual(deliveryAccess({ role: "staff", businessPermissions: ["containers"] }), all);
  // Deliveries alone: hand over, never undo, never see money.
  assert.deepEqual(deliveryAccess({ role: "staff", businessPermissions: ["deliveries"] }), {
    canDeliver: true, canUndo: false, canSeeMoney: false,
  });
  assert.deepEqual(deliveryAccess({ role: "staff", businessPermissions: ["deliveries", "ledger"] }), {
    canDeliver: true, canUndo: false, canSeeMoney: true,
  });
  // No implied permissions (the server checks exactly): invoices is not ledger.
  assert.deepEqual(deliveryAccess({ role: "staff", businessPermissions: ["invoices", "parking"] }), {
    canDeliver: false, canUndo: false, canSeeMoney: false,
  });
  assert.deepEqual(deliveryAccess({ role: "customer", businessPermissions: ["containers"] }).canDeliver, false);
  assert.deepEqual(deliveryAccess(null).canDeliver, false);
});

test("deliveries-only staff reach the package view of a scanned label, inside their own business", () => {
  const base = { signedIn: true, isAnonymous: false, adminOperations: false };
  assert.deepEqual(
    packageStaffScope({ ...base, profile: { role: "staff", businessId: "b1", businessPermissions: ["deliveries"] } }),
    { kind: "business", businessId: "b1" },
  );
  assert.deepEqual(packageStaffScope({ ...base, profile: { role: "staff", businessPermissions: ["deliveries"] } }), { kind: "none" });
  assert.deepEqual(
    packageStaffScope({ ...base, profile: { role: "staff", businessId: "b1", businessPermissions: ["parking"] } }),
    { kind: "none" },
  );
});

// ---------------------------------------------------------------------------
// Requests and answers.
// ---------------------------------------------------------------------------

test("the deliver request sends the name on one line and acknowledges only when told", () => {
  assert.deepEqual(deliverRequest({ businessId: " b1 ", lineId: "L1", collectedBy: "  Awa\n Diallo  " }), {
    businessId: "b1", lineId: "L1", action: "deliver", collectedBy: "Awa Diallo",
  });
  assert.deepEqual(deliverRequest({ businessId: "b1", lineId: "L1", collectedBy: "", acknowledgeBalance: true }), {
    businessId: "b1", lineId: "L1", action: "deliver", collectedBy: "", acknowledgeBalance: true,
  });
  assert.equal("acknowledgeBalance" in deliverRequest({ businessId: "b", lineId: "l", acknowledgeBalance: false }), false);
  assert.deepEqual(undoDeliveryRequest("b1", "L1"), { businessId: "b1", lineId: "L1", action: "undo_delivery" });
  assert.equal(collectedByError("x".repeat(MAX_COLLECTED_BY)), null);
  assert.equal(collectedByError("x".repeat(MAX_COLLECTED_BY + 1)), "collected_by_too_long");
});

test("who collected it opens on the receiver, else the line's customer", () => {
  assert.equal(defaultCollectedBy({ receiverName: "Mariama", customerName: "Fatou" }), "Mariama");
  assert.equal(defaultCollectedBy({ customerName: "Fatou" }), "Fatou");
  assert.equal(defaultCollectedBy({ ownerKind: "stock" }), "");
});

test("a refusal is read from details.reason, never the message", () => {
  const due = deliveryRefusalFrom({
    code: "functions/failed-precondition",
    message: "anything",
    details: { reason: "delivery_balance_due", hasBalance: true, balanceCents: 4000 },
  });
  assert.deepEqual(due, { reason: "delivery_balance_due", hasBalance: true, balanceCents: 4000 });
  // A deliveries-only caller is told there is a balance, not how much.
  assert.deepEqual(
    deliveryRefusalFrom({ details: { reason: "delivery_balance_due", hasBalance: true, balanceCents: null } }),
    { reason: "delivery_balance_due", hasBalance: true, balanceCents: null },
  );
  for (const reason of DELIVERY_SERVER_REASONS) {
    const refusal = deliveryRefusalFrom({ details: { reason } });
    assert.equal(refusal.reason, reason);
    assert.equal(deliveryRefusalText(refusal), DELIVERY_REFUSAL_COPY[reason]);
  }
  assert.equal(deliveryRefusalFrom({ code: "functions/permission-denied", message: "This staff account is not allowed" }).reason, "permission_denied");
  assert.equal(deliveryRefusalFrom(new Error("network")).reason, "unknown");
  assert.equal(deliveryRefusalFrom(null).reason, "unknown");
  assert.equal(deliveryRefusalFrom({ details: { reason: "something_new" } }).reason, "unknown");
});

test("the answers read as the right sentence", () => {
  const fresh = deliverAnswerFrom({ success: true, delivered: true, alreadyDelivered: false, collectedBy: "Awa", hasBalance: false, balanceCents: 0 });
  assert.deepEqual(fresh, { alreadyDelivered: false, collectedBy: "Awa", hasBalance: false, balanceCents: 0 });
  assert.equal(deliverResultText(fresh), DELIVERY_RESULT_COPY.delivered);
  assert.equal(deliverResultText(deliverAnswerFrom({ alreadyDelivered: true, balanceCents: null })), DELIVERY_RESULT_COPY.alreadyDelivered);
  assert.equal(deliverAnswerFrom({ balanceCents: null }).balanceCents, null);
  assert.equal(undoResultText({ success: true, undone: true }), DELIVERY_RESULT_COPY.undone);
  assert.equal(undoResultText({ success: true, undone: false }), DELIVERY_RESULT_COPY.notDelivered);
});

// ---------------------------------------------------------------------------
// Money: a warning, never a block.
// ---------------------------------------------------------------------------

test("the balance is the whole group's, and the warning names it only to people who see money", () => {
  const root = { id: "R", priceCents: 10000, paidCents: 6000, lastPartIndex: 2 };
  const part = { id: "P", rootLineId: "R", partIndex: 2, priceCents: 5000, paidCents: 0 };
  const groups = buildLineGroups([root, part]);
  const owed = deliveryBalanceCents(groupForLine(groups, part));
  assert.equal(owed, 9000);
  assert.equal(deliveryBalanceCents(groupForLine(null, { id: "X", priceCents: 2000, paidCents: 2000 })), 0);
  assert.equal(deliveryBalanceCents(groupForLine(null, { id: "Y" })), 0, "no price is no balance");

  assert.equal(deliveryBalanceWarning(4000, true), "This package still owes $40.00.");
  assert.equal(deliveryBalanceWarning(4000, true, "fr"), "Ce colis doit encore 40,00 $.");
  assert.equal(deliveryBalanceWarning(4000, false), "This package still has an unpaid balance — check with the office.");
  assert.equal(deliveryBalanceWarning(4000, false, "fr"), "Ce colis a encore un solde impayé : vérifiez auprès du bureau.");
  // The server said "a balance" without the amount: no amount, even for a manager.
  assert.equal(deliveryBalanceWarning(null, true), "This package still has an unpaid balance — check with the office.");
  assert.doesNotMatch(deliveryBalanceWarning(4000, false), /\$|40/);
});

// ---------------------------------------------------------------------------
// The delivered state.
// ---------------------------------------------------------------------------

test("a line is delivered, ready to hand over, or not there yet", () => {
  const arrived = { id: "C1", status: "arrived" };
  assert.equal(deliveryStage({ containerId: "C1" }, arrived), "ready");
  assert.equal(deliveryStage({ containerId: "C1" }, { id: "C1", status: "shipped" }), "not_arrived");
  assert.equal(deliveryStage({ containerId: "C1" }, { id: "C1", status: "loading" }), "not_arrived");
  assert.equal(deliveryStage({ containerId: "", containerStatus: "waiting" }, null), "not_arrived");
  // Another container's snapshot never counts for this line.
  assert.equal(deliveryStage({ containerId: "C1" }, { id: "C2", status: "arrived" }), "not_arrived");
  assert.equal(deliveryStage({ containerId: "C1" }, null), "not_arrived");
  const at = new Date("2026-10-21T15:00:00Z");
  const delivered = { containerId: "C1", deliveredAt: at, deliveredByName: "Ibrahima", deliveredByStaffId: "u1", collectedBy: "Awa" };
  assert.equal(deliveryStage(delivered, arrived), "delivered");
  assert.deepEqual(lineDelivery(delivered), {
    delivered: true, deliveredAt: at, deliveredByName: "Ibrahima", deliveredByStaffId: "u1", collectedBy: "Awa",
  });
  assert.equal(lineDelivery({ deliveredAt: { seconds: 1_790_000_000 } }).deliveredAt?.getTime(), 1_790_000_000_000);
  // Undone: the server deleted the fields, leaving deliveryUndoneAt.
  assert.equal(lineDelivery({ collectedBy: "stale", deliveryUndoneAt: at }).delivered, false);
  assert.equal(lineDelivery({ collectedBy: "stale" }).collectedBy, "");
});

test("\"X of Y delivered\" comes from the container's tallies, never above the total", () => {
  const box = { id: "C1", status: "arrived", lineCount: 5, deliveredCount: 2 };
  const progress = containerDeliveryProgress(box);
  assert.deepEqual(progress, { delivered: 2, total: 5 });
  assert.equal(deliveredOfText(progress), "2 of 5 delivered");
  assert.equal(deliveredOfText(progress, "fr"), "2 sur 5 livrés");
  assert.equal(deliveredOfText({ delivered: 1, total: 5 }, "fr"), "1 sur 5 livré");
  assert.equal(deliveredOfText({ delivered: 0, total: 5 }, "fr"), "0 sur 5 livré");
  assert.deepEqual(containerDeliveryProgress({ lineCount: 2, deliveredCount: 9 }), { delivered: 2, total: 2 });
  // Absent deliveredCount is 0; absent lineCount counts the lines on screen.
  assert.deepEqual(containerDeliveryProgress({ status: "arrived" }, [{}, {}, {}]), { delivered: 0, total: 3 });
  assert.equal(showsDeliveryProgress(box, progress), true);
  assert.equal(showsDeliveryProgress({ status: "arrived", lineCount: 3 }, { delivered: 0, total: 3 }), true);
  assert.equal(showsDeliveryProgress({ status: "shipped", lineCount: 3 }, { delivered: 0, total: 3 }), false);
  assert.equal(showsDeliveryProgress({ status: "shipped", lineCount: 3, deliveredCount: 1 }, { delivered: 1, total: 3 }), true);
  assert.equal(showsDeliveryProgress({ status: "arrived" }, { delivered: 0, total: 0 }), false);
});

test("a typed, pasted or scanned code is found", () => {
  assert.equal(deliveryCodeFrom("cl-k7m4p2"), "CL-K7M4P2");
  assert.equal(deliveryCodeFrom(" CL K7M4P2 "), "CL-K7M4P2");
  assert.equal(deliveryCodeFrom("CL-K7M4P2-2"), "CL-K7M4P2-2");
  assert.equal(deliveryCodeFrom("https://customer.laawoldigital.com/t/CL-K7M4P2"), "CL-K7M4P2");
  assert.equal(deliveryCodeFrom("https://customer.laawoldigital.com/t/CL-K7M4P2-3?x=1"), "CL-K7M4P2-3");
  assert.equal(deliveryCodeFrom("https://customer.laawoldigital.com/?service=tracking&code=CL-K7M4P2"), "CL-K7M4P2");
  assert.equal(deliveryCodeFrom("BS-K7M4P2"), "");
  assert.equal(deliveryCodeFrom("CL-K0M4P2"), "", "a zero is never in a code");
  assert.equal(deliveryCodeFrom(""), "");
});

// ---------------------------------------------------------------------------
// The WhatsApp delivered message, and History.
// ---------------------------------------------------------------------------

test("the delivered WhatsApp update has its label", () => {
  const updates = read("../../../my_flutter_app/functions/container_updates.js");
  assert.match(updates, /DELIVERED: "delivered",/);
  assert.equal(PACKAGE_UPDATE_SENTENCE.delivered, "Last update: delivered");
  assert.equal(packageLastUpdate({ update: "delivered", results: [] })?.sentence, "Last update: delivered");
  assert.equal(translateValue("Last update: delivered", "fr"), "Dernière mise à jour : livré");
});

test("the server's History sentences read in French with the typed parts carried across", () => {
  // The exact shapes container_delivery.js writes.
  assert.ok(serverSource.includes("return `Delivered ${oneLine(row.what) || \"a package\"}` +"));
  assert.ok(serverSource.includes("(who ? `, collected by ${who}` : \"\") +"));
  assert.ok(serverSource.includes("(owed ? `, with ${owed} still owed` : \"\");"));
  assert.ok(serverSource.includes("return `Undid the delivery of ${oneLine(what) || \"a package\"}`;"));
  for (const [english, french] of [
    ["Delivered 3 barrels for Fatou Diallo, collected by Mamadou Bah, with $40.00 still owed",
      "Livraison de 3 barils pour Fatou Diallo, récupéré par Mamadou Bah, avec $40.00 encore dû"],
    ["Delivered 3 barrels for Fatou Diallo, collected by Fatou Diallo",
      "Livraison de 3 barils pour Fatou Diallo, récupéré par Fatou Diallo"],
    ["Delivered 1 barrel for Awa, collected by Pickup",
      "Livraison de 1 baril pour Awa, récupéré par Pickup"],
    ["Delivered 2 barrels, 1 box for Awa, collected by Awa",
      "Livraison de 2 barils, 1 carton pour Awa, récupéré par Awa"],
    ["Delivered car 1HGCM82633A004352 for Ali, collected by Ali, with $1,250.50 still owed",
      "Livraison de la voiture 1HGCM82633A004352 pour Ali, récupéré par Ali, avec $1,250.50 encore dû"],
    ["Delivered 2 × TV, collected by Bob", "Livraison de 2 × TV, récupéré par Bob"],
    ["Delivered a package", "Livraison d’un colis"],
    ["Undid the delivery of 3 barrels for Fatou Diallo", "Livraison annulée : 3 barils pour Fatou Diallo"],
    ["Undid the delivery of a package", "Livraison annulée : un colis"],
  ]) {
    assert.equal(translateAuditSummary(english), french, english);
  }
});

// ---------------------------------------------------------------------------
// French: every sentence the delivery screens show.
// ---------------------------------------------------------------------------

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

test("the sentences the pure module builds have their French, and it converges", () => {
  const strings = [
    ...Object.values(DELIVERY_REFUSAL_COPY),
    ...Object.values(DELIVERY_RESULT_COPY),
    ...Object.values(DELIVERY_PROGRESS_COPY),
    DELIVERY_NOT_ARRIVED_HINT,
    // Built in package-delivery.tsx from a variable, so the scan cannot see them.
    "Mark delivered", "Mark delivered anyway",
    // The tab and the permission (business-sidebar.ts, profile-support-people.tsx).
    "Deliveries", "Mark packages delivered", "Hand packages over at the destination",
    // The containers panel's History labels.
    "Delivered", "Delivery undone",
  ];
  assert.deepEqual(missingFrench(strings), []);
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
    assert.equal(translateValue(french, "en"), english, `${english} reads back`);
  }
});

for (const [name, path] of [
  ["the Deliveries tab", "../components/business/deliveries-panel.tsx"],
  ["the delivery dialog and section", "../components/business/package-delivery.tsx"],
  // The package view the Deliveries tab embeds (its new not-found sentence).
  ["the package staff view", "../components/package-staff-view.tsx"],
] as const) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(read(path), path);
    assert.ok(strings.length >= 5, "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

test("what people typed on the delivery screens is marked so the French pass leaves it alone", () => {
  const dialog = read("../components/business/package-delivery.tsx");
  assert.match(dialog, /<b data-no-translate>\{delivery\.collectedBy\}<\/b>/);
  assert.match(dialog, /<b data-no-translate>\{delivery\.deliveredByName\}<\/b>/);
  assert.match(dialog, /<span data-no-translate>\{delivery\.collectedBy\}<\/span>/);
  // The warning is built in the reader's language already.
  assert.match(dialog, /data-no-translate>\{deliveryBalanceWarning\(/);
  const panel = read("../components/business/containers-panel.tsx");
  assert.match(panel, /<small data-no-translate>\{deliveredOfText\(delivery, lang\)\}<\/small>/);
  assert.match(panel, /<b data-no-translate>\{deliveredOfText\(selectedDelivery, lang\)\}<\/b>/);
});

test("every delivery action shows progress and blocks a second tap", () => {
  const dialog = read("../components/business/package-delivery.tsx");
  // Mark delivered: busy disables both buttons, spins, and resets in finally.
  assert.match(dialog, /const primaryLabel = busy \? DELIVERY_PROGRESS_COPY\.deliver/);
  assert.match(dialog, /aria-busy=\{busy\}\s+className="lst-btn"\s+disabled=\{busy\}/);
  assert.match(dialog, /\} finally \{\s*setBusy\(false\);\s*\}/);
  // Undo: the same, in both of its looks.
  assert.match(dialog, /\{busy \? DELIVERY_PROGRESS_COPY\.undo : "Undo delivery"\}/);
  // The dialog cannot be dismissed half-way.
  assert.match(dialog, /const close = \(\) => \{\s*if \(!busy\) onClose\(\);/);
});

test("a deliveries-only person sees no money on the package view", () => {
  const view = read("../components/package-staff-view.tsx");
  assert.match(view, /const access = useMemo\(\(\) => deliveryAccess\(profile\), \[profile\]\);/);
  assert.match(view, /\{access\.canSeeMoney && view\.payment\.priceCents !== null && \(/);
  assert.match(view, /\{access\.canSeeMoney && \(\s*<div><span>Payment<\/span>/);
  // Labels need the Containers permission on the server.
  assert.match(view, /\{access\.canUndo && \(\s*<div className="pkg-staff-actions">/);
});
