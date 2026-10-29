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
  DELIVERED_WITHOUT_CODE_LABEL,
  MAX_COLLECTED_BY,
  PROOF_REFUSAL_COPY,
  arrivedContainerRows,
  collectedByError,
  collectedDollarsToCents,
  overrideError,
  pickupCodeAsked,
  pickupCodeComplete,
  pickupCodeDigits,
  proofPickupCodeOn,
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

const proofSource = read("../../../my_flutter_app/functions/package_proof.js");
const manifestSource = read("../../../my_flutter_app/functions/container_manifest.js");

function messagesIn(source: string, name: string): Record<string, string> {
  const block = source.match(new RegExp(`const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`));
  assert.ok(block, `server ${name} not found`);
  const out: Record<string, string> = {};
  for (const [, key, raw] of block![1].matchAll(/(\w+):\s*((?:"[^"]*"\s*\+?\s*)+),/g)) {
    out[key] = [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
  }
  return out;
}

/**
 * DELIVERY_MESSAGES spreads package_proof.REFUSAL (`...PROOF_REFUSAL`), so
 * the server's vocabulary is both blocks together.
 */
function serverMessages(): Record<string, string> {
  assert.match(serverSource, /\.\.\.PROOF_REFUSAL,/, "the server spreads the proof refusals");
  return { ...messagesIn(serverSource, "DELIVERY_MESSAGES"), ...messagesIn(proofSource, "REFUSAL") };
}

test("every refusal reason the server raises has its sentence, word for word", () => {
  const server = serverMessages();
  assert.ok(Object.keys(server).length >= 12, "expected the full server vocabulary");
  // The money collected at handover is judged as a payment: those two codes
  // come from CONTAINER_MESSAGES (deliveryError falls back to containerMessage).
  const payment = messagesIn(manifestSource, "CONTAINER_MESSAGES");
  for (const key of ["payment_exceeds_balance", "price_required"]) server[key] = payment[key];
  assert.deepEqual([...DELIVERY_SERVER_REASONS].sort(), Object.keys(server).sort());
  for (const [key, sentence] of Object.entries(server)) {
    assert.equal(DELIVERY_REFUSAL_COPY[key as keyof typeof DELIVERY_REFUSAL_COPY], sentence, key);
  }
  assert.deepEqual({ ...PROOF_REFUSAL_COPY }, messagesIn(proofSource, "REFUSAL"));
  // Plus the two the console adds: no permission, and anything else.
  assert.ok(DELIVERY_REFUSAL_COPY.permission_denied);
  assert.ok(DELIVERY_REFUSAL_COPY.unknown);
});

test("the handover rule mirrors package_proof.handoverCheck: the switch and a 4-digit code", () => {
  assert.match(proofSource, /if \(!settings\?\.pickupCode \|\| !stored\)/);
  assert.match(proofSource, /return a\.length === 4 && a === b;/);
  assert.equal(pickupCodeAsked({ pickupCode: true }, { pickupCode: "4821" }), true);
  assert.equal(pickupCodeAsked({ pickupCode: true }, { pickupCode: "" }), false, "no code minted: delivered normally");
  assert.equal(pickupCodeAsked({ pickupCode: false }, { pickupCode: "4821" }), false, "switch off: delivered normally");
  assert.equal(pickupCodeAsked(null, { pickupCode: "4821" }), false);
  assert.equal(proofPickupCodeOn({ packageProofSettings: { pickupCode: true } }), true);
  assert.equal(proofPickupCodeOn({ packageProofSettings: { pickupCode: "yes" } }), false);
  assert.equal(proofPickupCodeOn({}), false);
  assert.equal(pickupCodeDigits(" 48-21 "), "4821");
  assert.equal(pickupCodeDigits("482199"), "4821");
  assert.equal(pickupCodeComplete("482"), false);
  assert.equal(pickupCodeComplete("4821"), true);
  assert.equal(overrideError({ collectedBy: "Aw", photoPath: "packagePhotos/b/u/abcdefgh.jpg" }), null);
  assert.equal(overrideError({ collectedBy: "A", photoPath: "packagePhotos/b/u/abcdefgh.jpg" }), "override_incomplete");
  assert.equal(overrideError({ collectedBy: "Awa", photoPath: "" }), "override_incomplete");
});

test("collected now is whole dollars to cents: blank is nothing, nonsense is NaN", () => {
  assert.equal(collectedDollarsToCents(""), null);
  assert.equal(collectedDollarsToCents("  "), null);
  assert.equal(collectedDollarsToCents("40"), 4000);
  assert.equal(collectedDollarsToCents("$1,250"), 125000);
  assert.equal(collectedDollarsToCents("12.5"), 1250);
  assert.equal(collectedDollarsToCents("0"), 0);
  assert.ok(Number.isNaN(collectedDollarsToCents("-4")));
  assert.ok(Number.isNaN(collectedDollarsToCents("forty")));
  assert.ok(Number.isNaN(collectedDollarsToCents("1.234")));
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
  // The pickup code, the override and the money collected (docs/AIR_PACKAGES.md §4.7).
  assert.deepEqual(deliverRequest({ businessId: "b1", lineId: "L1", collectedBy: "Awa", pickupCode: " 48 21", collectedCents: 4000 }), {
    businessId: "b1", lineId: "L1", action: "deliver", collectedBy: "Awa", pickupCode: "4821", collectedCents: 4000,
  });
  const withOverride = deliverRequest({
    businessId: "b1", lineId: "L1", collectedBy: "Awa",
    override: { collectedBy: " Mamadou\nBah ", photoPath: "packagePhotos/b1/u1/abcdefgh.jpg" },
    collectedCents: 0,
  });
  assert.deepEqual(withOverride.override, { collectedBy: "Mamadou Bah", photoPath: "packagePhotos/b1/u1/abcdefgh.jpg" });
  assert.equal("pickupCode" in withOverride, false);
  assert.equal("collectedCents" in withOverride, false, "nothing collected is not sent");
  assert.equal("collectedCents" in deliverRequest({ businessId: "b", lineId: "l", collectedCents: null }), false);
  assert.equal("override" in deliverRequest({ businessId: "b", lineId: "l", override: null }), false);
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
  assert.deepEqual(fresh, {
    alreadyDelivered: false, collectedBy: "Awa", hasBalance: false, balanceCents: 0,
    deliveredWithoutCode: false, collectedCents: 0, paymentId: "",
  });
  assert.equal(deliverResultText(fresh), DELIVERY_RESULT_COPY.delivered);
  assert.equal(deliverResultText(deliverAnswerFrom({ alreadyDelivered: true, balanceCents: null })), DELIVERY_RESULT_COPY.alreadyDelivered);
  assert.equal(deliverAnswerFrom({ balanceCents: null }).balanceCents, null);
  // Handed over without the code, with money collected: the answer says so.
  const collected = deliverAnswerFrom({ alreadyDelivered: false, deliveredWithoutCode: true, collectedCents: 4000, paymentId: "pay1", balanceCents: 1000, hasBalance: true });
  assert.equal(collected.deliveredWithoutCode, true);
  assert.equal(collected.collectedCents, 4000);
  assert.equal(collected.paymentId, "pay1");
  assert.equal(deliverResultText(collected), "Delivered · $40.00 collected");
  assert.equal(deliverResultText(collected, "fr"), "Livré · 40,00 $ encaissés");
  assert.equal(deliverResultText({ alreadyDelivered: true, collectedCents: 4000 }), DELIVERY_RESULT_COPY.alreadyDelivered);
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
    withoutCode: false, photoPath: "", collectedCents: 0,
  });
  // Without the code: the override's photo and the money collected show.
  const overridden = lineDelivery({ ...delivered, deliveredWithoutCode: true, deliveredPhotoPath: "packagePhotos/b/u/abcdefgh.jpg", collectedAtDeliveryCents: 2500 });
  assert.equal(overridden.withoutCode, true);
  assert.equal(overridden.photoPath, "packagePhotos/b/u/abcdefgh.jpg");
  assert.equal(overridden.collectedCents, 2500);
  assert.equal(lineDelivery({ deliveredWithoutCode: true, deliveredPhotoPath: "x" }).withoutCode, false, "undone: nothing lingers");
  assert.equal(lineDelivery({ deliveredAt: { seconds: 1_790_000_000 } }).deliveredAt?.getTime(), 1_790_000_000_000);
  // Undone: the server deleted the fields, leaving deliveryUndoneAt.
  assert.equal(lineDelivery({ collectedBy: "stale", deliveryUndoneAt: at }).delivered, false);
  assert.equal(lineDelivery({ collectedBy: "stale" }).collectedBy, "");
});

test("the Deliveries page lists arrived containers (air and sea) with what is still to hand over", () => {
  const containers = [
    { id: "SEA", status: "arrived", containerNumber: "MSKU1234565", arrivedAt: new Date("2026-10-20T10:00:00Z") },
    { id: "AIR", status: "arrived", shipMode: "air", label: "Flight Oct 28", airWaybill: "176-12345678", arrivedAt: new Date("2026-10-28T10:00:00Z") },
    { id: "AT_SEA", status: "shipped", containerNumber: "MSKU0000001" },
    { id: "EMPTY", status: "arrived", label: "All handed over" },
  ];
  const lines = [
    { id: "l1", containerId: "SEA", trackingCode: "CL-B00002", receiverName: "Awa", receiverPhone: "+224 622 00 00 01", pieces: [{}, {}] },
    { id: "l2", containerId: "SEA", trackingCode: "CL-A00001", customerName: "Fatou", customerPhone: "+1 347 555 0100", quantity: 3 },
    { id: "l3", containerId: "SEA", trackingCode: "CL-C00003", receiverName: "Done", deliveredAt: new Date() },
    { id: "l4", containerId: "AIR", trackingCode: "CL-D00004", receiverName: "Mamadou", receiverPhone: "+224 622 00 00 02", pieces: [{}] },
    { id: "l5", containerId: "EMPTY", trackingCode: "CL-E00005", deliveredAt: new Date() },
    { id: "l6", containerId: "AT_SEA", trackingCode: "CL-F00006" },
  ];
  const rows = arrivedContainerRows(containers, lines);
  assert.deepEqual(rows.map((row) => [row.id, row.title, row.air, row.lines.map((l) => l.trackingCode)]), [
    ["AIR", "Flight Oct 28", true, ["CL-D00004"]],
    ["SEA", "MSKU1234565", false, ["CL-A00001", "CL-B00002"]],
  ]);
  const awa = rows[1].lines[1];
  assert.deepEqual([awa.receiverName, awa.receiverPhone, awa.pieceCount], ["Awa", "+224 622 00 00 01", 2]);
  const fatou = rows[1].lines[0];
  assert.deepEqual([fatou.receiverName, fatou.receiverPhone, fatou.pieceCount], ["Fatou", "+1 347 555 0100", 3]);
  assert.equal(fatou.line.id, "l2", "the row keeps the line for the dialog");
  assert.deepEqual(arrivedContainerRows([], lines), []);
  // An air container with no working name is known by its waybill.
  assert.equal(arrivedContainerRows([{ id: "A", status: "arrived", shipMode: "air", airWaybill: "176-12345678" }], [{ id: "x", containerId: "A" }])[0].title, "176-12345678");
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
    DELIVERED_WITHOUT_CODE_LABEL,
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
