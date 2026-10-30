"use strict";

// Package delivered at destination (container_delivery.js): the pure rules,
// the delivered WhatsApp message, and the wiring in index.js (an action on
// updateContainerLine, never a new export). The behaviour against Firestore
// is in container-callables.test.js (npm run test:containers).

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  DELIVERY_ACTION,
  DELIVERY_SECTIONS,
  DELIVERY_UNDO_SECTION,
  DELIVERY_MONEY_SECTIONS,
  DELIVERY_FIELDS,
  DELIVERY_MESSAGES,
  MAX_COLLECTED_BY,
  deliveryActionOf,
  lineIsDelivered,
  deliveryRefusal,
  collectedByOf,
  collectedByErrors,
  deliveryBalanceRefusal,
  deliveryBalanceView,
  deliveryRecord,
  deliveredLineCount,
  containerDeliveryProgress,
  deliveryAuditSummary,
  deliveryUndoAuditSummary,
} = require("../container_delivery");
const {
  CONTAINER_UPDATE,
  updateRank,
  messageUpdateFor,
  mergeLastCustomerUpdate,
  recipientsForLine,
  containerUpdateMessageId,
  whatsappUpdateMessage,
  deliveryDayText,
} = require("../container_updates");

const line = (extra = {}) => ({
  businessId: "biz1",
  kind: "barrels", quantity: 3, ownerKind: "customer",
  customerName: "Fatou Diallo", customerPhone: "+16465550100",
  receiverName: "Mariama Bah", receiverPhone: "+224620000000",
  containerId: "box1", containerStatus: "arrived",
  trackingCode: "CL-K7M4P2",
  ...extra,
});

describe("the delivery actions", () => {
  it("knows deliver and undo_delivery, nothing else", () => {
    assert.equal(deliveryActionOf("deliver"), DELIVERY_ACTION.DELIVER);
    assert.equal(deliveryActionOf(" undo_delivery "), DELIVERY_ACTION.UNDO);
    for (const bad of ["", null, undefined, "delete", "Deliver", 3]) {
      assert.equal(deliveryActionOf(bad), "");
    }
  });

  it("lets containers or deliveries mark, only containers undo, and " +
      "containers or ledger see money", () => {
    assert.deepEqual([...DELIVERY_SECTIONS].sort(),
        ["containers", "deliveries"]);
    assert.equal(DELIVERY_UNDO_SECTION, "containers");
    assert.deepEqual([...DELIVERY_MONEY_SECTIONS].sort(),
        ["containers", "ledger"]);
    assert.ok(!DELIVERY_MONEY_SECTIONS.includes("deliveries"));
  });

  it("has a message for every refusal", () => {
    for (const code of ["delivery_action_invalid", "delivery_not_arrived",
      "delivery_balance_due", "collected_by_too_long", "line_not_found"]) {
      assert.ok(DELIVERY_MESSAGES[code], code);
    }
  });
});

describe("when a package can be delivered", () => {
  it("only on a container marked ready for pickup (stored arrived)", () => {
    assert.equal(deliveryRefusal(line(), {status: "arrived"}), null);
    for (const status of ["loading", "shipped", "", undefined]) {
      assert.equal(deliveryRefusal(line(), {status}), "delivery_not_arrived",
          String(status));
    }
  });

  it("never a waiting package, nor one whose box is gone", () => {
    assert.equal(deliveryRefusal(
        line({containerId: "", containerStatus: "waiting"}), null),
    "delivery_not_arrived");
    assert.equal(deliveryRefusal(line(), null), "delivery_not_arrived");
  });

  it("reads delivered from deliveredAt", () => {
    assert.equal(lineIsDelivered(line()), false);
    assert.equal(lineIsDelivered(line({deliveredAt: {seconds: 1}})), true);
    assert.equal(lineIsDelivered(null), false);
  });
});

describe("who collected it", () => {
  it("is the receiver unless staff name someone else", () => {
    assert.equal(collectedByOf("", line()), "Mariama Bah");
    assert.equal(collectedByOf("  ", line()), "Mariama Bah");
    assert.equal(collectedByOf("Ibrahima\n Sow", line()), "Ibrahima Sow");
  });

  it("falls back to the line's customer when there is no receiver", () => {
    assert.equal(collectedByOf("", line({receiverName: ""})), "Fatou Diallo");
    assert.equal(collectedByOf("", {}), "");
  });

  it("refuses a name longer than 120 characters", () => {
    assert.deepEqual(collectedByErrors("a".repeat(MAX_COLLECTED_BY)), []);
    assert.deepEqual(collectedByErrors("a".repeat(MAX_COLLECTED_BY + 1)),
        ["collected_by_too_long"]);
    assert.deepEqual(collectedByErrors(undefined), []);
  });
});

describe("an unpaid balance warns, never blocks", () => {
  it("asks for confirmation while money is owed", () => {
    assert.equal(deliveryBalanceRefusal(4000, false), "delivery_balance_due");
    assert.equal(deliveryBalanceRefusal(4000, undefined),
        "delivery_balance_due");
    assert.equal(deliveryBalanceRefusal(4000, true), null);
    // Only `true` confirms.
    assert.equal(deliveryBalanceRefusal(4000, "true"),
        "delivery_balance_due");
  });

  it("never asks for a paid or unpriced package", () => {
    for (const owed of [0, -5, null, undefined, NaN]) {
      assert.equal(deliveryBalanceRefusal(owed, false), null);
    }
  });

  it("names the amount only to someone who may see money", () => {
    assert.deepEqual(deliveryBalanceView(4000, true),
        {hasBalance: true, balanceCents: 4000});
    assert.deepEqual(deliveryBalanceView(4000, false),
        {hasBalance: true, balanceCents: null});
    assert.deepEqual(deliveryBalanceView(0, false),
        {hasBalance: false, balanceCents: null});
    assert.deepEqual(deliveryBalanceView(0, true),
        {hasBalance: false, balanceCents: 0});
  });
});

describe("what a delivery records", () => {
  it("writes who, collected by whom, and what was owed", () => {
    assert.deepEqual(deliveryRecord({staffId: "u1", staffName: "Awa\nBarry",
      collectedBy: "Ibrahima", balanceCents: 4000}), {
      deliveredByStaffId: "u1",
      deliveredByName: "Awa Barry",
      collectedBy: "Ibrahima",
      deliveredBalanceCents: 4000,
      deliveredWithoutCode: false,
      deliveredPhotoPath: "",
    });
    assert.equal(deliveryRecord({}).deliveredBalanceCents, 0);
  });

  it("clears exactly what it wrote on undo", () => {
    const written = Object.keys(deliveryRecord({})).concat("deliveredAt");
    assert.deepEqual([...DELIVERY_FIELDS].sort(), written.sort());
  });

  it("counts X of Y delivered", () => {
    assert.equal(deliveredLineCount([line(), line({deliveredAt: 1}),
      line({deliveredAt: {seconds: 2}})]), 2);
    assert.equal(deliveredLineCount(null), 0);
    assert.deepEqual(containerDeliveryProgress({lineCount: 5,
      deliveredCount: 2}), {delivered: 2, total: 5});
    // A box from before deliveries counts none; a drifted count is capped.
    assert.deepEqual(containerDeliveryProgress({lineCount: 3}),
        {delivered: 0, total: 3});
    assert.deepEqual(containerDeliveryProgress({lineCount: 2,
      deliveredCount: 4}), {delivered: 2, total: 2});
  });

  it("tells History who collected it and what was still owed", () => {
    assert.equal(deliveryAuditSummary({what: "3 barrels for Fatou Diallo",
      collectedBy: "Mariama Bah", balanceText: "$40.00"}),
    "Delivered 3 barrels for Fatou Diallo, collected by Mariama Bah, with " +
      "$40.00 still owed");
    assert.equal(deliveryAuditSummary({what: "1 barrel for Fatou",
      collectedBy: "Mariama Bah", balanceText: ""}),
    "Delivered 1 barrel for Fatou, collected by Mariama Bah");
    assert.equal(deliveryUndoAuditSummary("1 barrel for Fatou"),
        "Undid the delivery of 1 barrel for Fatou");
  });
});

describe("the delivered message", () => {
  it("is an update of its own, after ready for pickup", () => {
    assert.equal(CONTAINER_UPDATE.DELIVERED, "delivered");
    assert.equal(messageUpdateFor("delivered", "bilingual"), "delivered");
    assert.equal(messageUpdateFor("delivered", "legacy"), "delivered");
    assert.ok(updateRank("delivered") > updateRank("arrived"));
    // A late "ready for pickup" send never replaces the delivered summary.
    const delivered = mergeLastCustomerUpdate(null, "delivered",
        [{role: "receiver", status: "queued"}], 1);
    assert.equal(mergeLastCustomerUpdate(delivered, "arrived",
        [{role: "receiver", status: "sent"}], 2), null);
  });

  it("goes to the sender and the receiver, once each", () => {
    const {send} = recipientsForLine(line());
    assert.deepEqual(send.map((who) => who.role), ["sender", "receiver"]);
    const ids = send.map((who) =>
      containerUpdateMessageId("line1", who.role, "delivered"));
    assert.deepEqual(ids, ["line1_sender_delivered",
      "line1_receiver_delivered"]);
    // The same person on both sides hears once.
    assert.equal(recipientsForLine(line({senderIsReceiver: true,
      customerPhone: "+224620000000"})).send.length, 1);
    assert.equal(recipientsForLine(line({
      customerPhone: "+224 620 00 00 00"})).send.length, 1);
    // A US business's local number is messaged as +1.
    const us = recipientsForLine(line({customerPhone: "6465550100"}),
        {businessCountry: "US"});
    assert.equal(us.send[0].phone, "+16465550100");
  });

  it("writes the day in English and French, in UTC", () => {
    const at = {toMillis: () => Date.UTC(2026, 9, 21, 23, 30)};
    assert.equal(deliveryDayText(at, "en"), "October 21, 2026");
    assert.equal(deliveryDayText(at, "fr"), "21 octobre 2026");
    assert.equal(deliveryDayText(null, "en"), "");
  });

  it("builds shipment_delivered_2lang from the line", () => {
    const body = whatsappUpdateMessage({
      phone: "+224620000000", name: "Mariama Bah", businessName: "Dala",
      line: line({deliveredAt: new Date(Date.UTC(2026, 9, 21, 12)),
        collectedBy: "Ibrahima Sow"}),
      container: {destinationCountryId: "gn"},
      update: "delivered", trackingCode: "CL-K7M4P2",
    });
    assert.equal(body.template.name, "shipment_delivered_2lang");
    assert.equal(body.template.language.code, "en");
    assert.deepEqual(body.template.components[0].parameters
        .map((p) => p.text), [
      "Mariama Bah",
      "Dala", "3 barrels", "October 21, 2026", "Ibrahima Sow",
      "Dala", "3 barils", "21 octobre 2026", "Ibrahima Sow",
      "CL-K7M4P2",
    ]);
    assert.deepEqual(body.template.components[1].parameters,
        [{type: "text", text: "CL-K7M4P2"}]);
  });
});

describe("the server wiring", () => {
  const source = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const section = (start, end) => {
    const from = source.indexOf(start);
    assert.ok(from > -1, start);
    const to = source.indexOf(end, from + start.length);
    return source.slice(from, to === -1 ? undefined : to);
  };

  it("is an action on updateContainerLine, never a new export", () => {
    // No export names a package or line delivery: it rides
    // updateContainerLine.
    const delivering = [...source.matchAll(/exports\.([A-Za-z]+) = /g)]
        .map((m) => m[1])
        .filter((name) => /Deliver/.test(name) && /Package|Line/.test(name));
    assert.deepEqual(delivering, []);
    for (const name of ["markPackageDelivered", "markContainerLineDelivered",
      "undoPackageDelivery", "deliverContainerLine"]) {
      assert.ok(!source.includes(`exports.${name} =`), name);
    }
    const body = section("exports.updateContainerLine = onCall(",
        "\nexports.");
    assert.match(body, /containerLineDelivery\(admin\.firestore\(\)/);
    assert.match(body,
        /secrets: \[whatsappAccessToken, whatsappPhoneNumberId\]/);
    // The action is dispatched before the containers-only edit gate.
    assert.ok(body.indexOf("containerLineDelivery(") <
      body.indexOf("requireBusinessPermission(uid, businessId, " +
        "CONTAINER_SECTION)"));
  });

  it("gates marking on containers or deliveries, undo on containers", () => {
    const body = section("async function containerLineDelivery(",
        "\n}\n");
    assert.match(body,
        /requireBusinessPermission\(uid, businessId, DELIVERY_UNDO_SECTION\)/);
    assert.match(body,
        /requireAnyBusinessPermission\(uid, businessId, DELIVERY_SECTIONS\)/);
    assert.match(body, /DELIVERY_MONEY_SECTIONS\.some/);
  });

  it("delivers in one transaction with the container's count, and " +
      "queues only a new delivery", () => {
    const body = section("async function containerLineDelivery(",
        "\n}\n");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /const lineDoc = await tx\.get\(lineRef\)/);
    assert.match(body, /deliveredCount: FirestoreFieldValue\.increment\(1\)/);
    assert.match(body,
        /deliveredCount: FirestoreFieldValue\.increment\(-1\)/);
    assert.match(body, /deliveryBalanceRefusal\(/);
    assert.match(body, /txLineGroup\(tx, db, businessId, lineId, row\)/);
    const queued = body.indexOf("await queuePackageDelivered(db");
    assert.ok(queued > body.indexOf("await db.runTransaction("));
    // Inside `if (changed)` of the deliver branch, never on undo.
    const undoBranch = body.slice(
        body.indexOf("if (action === DELIVERY_ACTION.UNDO) {\n    if"),
        body.indexOf("return {success: true, lineId, undone: changed};"));
    assert.ok(!undoBranch.includes("queuePackageDelivered"));
  });

  it("queues the delivered message like package_received", () => {
    const helper = section("async function queuePackageDelivered(",
        "\n}\n");
    assert.match(helper, /queueContainerLineUpdate\(db, \{/);
    assert.match(helper, /update: CONTAINER_UPDATE\.DELIVERED/);
    assert.match(helper, /containerWhatsAppConfigured\(\)/);
    assert.match(helper, /CONTAINER_UPDATE_STATUS\.WAITING/);
    assert.match(helper, /requeue: false/);
    assert.match(helper, /catch \(error\) \{\s*logger\.error/);
  });

  it("does not send a delivered message for an undone delivery", () => {
    const body = section("exports.deliverContainerCustomerUpdate",
        "\nexports.");
    assert.match(body, /row\.update === CONTAINER_UPDATE\.DELIVERED && /);
    assert.match(body, /!lineIsDelivered\(line\)/);
  });

  it("repairs deliveredCount in every recount", () => {
    const body = section("async function refreshContainerCounts(",
        "\n}\n");
    assert.match(body, /deliveredCount: deliveredLineCount\(rows\)/);
  });

  // Handover with the pickup code (docs/AIR_PACKAGES.md §4.7).
  it("checks the code, the override photo and records the money with the " +
      "payment helpers", () => {
    const body = section("async function containerLineDelivery(",
        "\n}\n");
    assert.match(body, /deliveryHandover\(proofSettings, row, data\)/);
    assert.match(body, /collectedCentsOf\(data\.collectedCents\)/);
    assert.match(body, /deliveryPaymentInput\(collectedCents, receiverId\)/);
    // The same judge and record as recordContainerLinePayment, on the
    // root, with paidCents recomputed from the live payments.
    assert.match(body, /validateContainerLinePayment\(payment,/);
    assert.match(body, /containerLinePaymentRecord\(payment, uid\)/);
    assert.match(body, /sumContainerLivePayments\(/);
    assert.match(body, /lineId: group\.rootId,/);
    assert.match(body, /paidCents: paidAfter,/);
    assert.match(body,
        /collectedAtDeliveryCents: paymentRecord\.amountCents/);
    assert.match(body,
        /photoAttachable\(overridePhoto, \{businessId, uid\}\)/);
    // The override photo is checked before the delivery is written.
    assert.ok(body.indexOf("throw deliveryError(\"photo_invalid\")") <
      body.indexOf("...deliveryRecord({staffId: uid"));
  });
});

// Handover with the pickup code (docs/AIR_PACKAGES.md §4.7): the code, the
// override, the money collected, and what the line and History record.
describe("the pickup code at handover", () => {
  const {
    DELIVERY_PAYMENT_METHOD,
    DELIVERY_PAYMENT_NOTE,
    deliveryHandover,
    collectedCentsOf,
    deliveryPaymentInput,
  } = require("../container_delivery");
  const on = {pickupCode: true};
  const PHOTO = "packagePhotos/biz1/agent1/abcd1234efgh.jpg";

  it("delivers on the code, refuses a wrong one, takes the override", () => {
    const coded = line({pickupCode: "4821"});
    assert.deepEqual(deliveryHandover(on, coded, {pickupCode: "4821"}),
        {refusal: "", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded, {pickupCode: "48 21"}),
        {refusal: "", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded, {pickupCode: "1111"}),
        {refusal: "pickup_code_invalid", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded, {}),
        {refusal: "pickup_code_invalid", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded,
        {override: {collectedBy: "Ibrahima Sow", photoPath: PHOTO}}),
    {refusal: "", withoutCode: true});
    assert.deepEqual(deliveryHandover(on, coded,
        {override: {collectedBy: "I", photoPath: PHOTO}}),
    {refusal: "override_incomplete", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded,
        {override: {collectedBy: "Ibrahima Sow"}}),
    {refusal: "override_incomplete", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, coded, {override: "yes"}),
        {refusal: "pickup_code_invalid", withoutCode: false});
    // The switch off, or a line minted before it: no code asked.
    assert.deepEqual(deliveryHandover({}, coded, {}),
        {refusal: "", withoutCode: false});
    assert.deepEqual(deliveryHandover(on, line(), {}),
        {refusal: "", withoutCode: false});
    assert.ok(DELIVERY_MESSAGES.pickup_code_invalid);
    assert.ok(DELIVERY_MESSAGES.override_incomplete);
    assert.ok(DELIVERY_MESSAGES.collected_cents_invalid);
  });

  it("records the override on the line and clears it on undo", () => {
    const record = deliveryRecord({staffId: "u1", staffName: "Awa",
      collectedBy: "Ibrahima Sow", balanceCents: 0, withoutCode: true,
      photoPath: PHOTO});
    assert.equal(record.deliveredWithoutCode, true);
    assert.equal(record.deliveredPhotoPath, PHOTO);
    const plain = deliveryRecord({staffId: "u1", withoutCode: false,
      photoPath: PHOTO});
    assert.equal(plain.deliveredWithoutCode, false);
    assert.equal(plain.deliveredPhotoPath, "");
    assert.ok(DELIVERY_FIELDS.includes("deliveredWithoutCode"));
    assert.ok(DELIVERY_FIELDS.includes("deliveredPhotoPath"));
    assert.ok(!DELIVERY_FIELDS.includes("collectedAtDeliveryCents"));
  });

  it("takes USD collected as whole cents, zero or more", () => {
    assert.equal(collectedCentsOf(undefined), 0);
    assert.equal(collectedCentsOf(""), 0);
    assert.equal(collectedCentsOf(0), 0);
    assert.equal(collectedCentsOf(4000), 4000);
    assert.equal(collectedCentsOf("4000"), 4000);
    for (const bad of [-1, 12.5, "forty", {}]) {
      assert.ok(Number.isNaN(collectedCentsOf(bad)), String(bad));
    }
    assert.deepEqual(deliveryPaymentInput(4000, "agent1"), {
      amountCents: 4000, method: DELIVERY_PAYMENT_METHOD,
      note: DELIVERY_PAYMENT_NOTE, receivedByStaffId: "agent1"});
    assert.equal(DELIVERY_PAYMENT_METHOD, "cash");
    assert.equal(DELIVERY_PAYMENT_NOTE, "At pickup");
  });

  it("says so in History", () => {
    assert.equal(deliveryAuditSummary({what: "3 barrels for Fatou Diallo",
      collectedBy: "Ibrahima Sow", withoutCode: true,
      collectedText: "$40.00", balanceText: "$20.00"}),
    "Delivered 3 barrels for Fatou Diallo, collected by Ibrahima Sow " +
      "without a pickup code, $40.00 collected, with $20.00 still owed");
    assert.equal(deliveryAuditSummary({what: "3 barrels",
      collectedBy: "Mariama Bah"}),
    "Delivered 3 barrels, collected by Mariama Bah");
  });
});
