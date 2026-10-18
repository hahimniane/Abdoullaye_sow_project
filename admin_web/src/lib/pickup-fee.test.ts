import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTAINER_MESSAGES,
  containerLineDraftFromRow,
  containerLinePayload,
  validateContainerLineDraft,
} from "./container-manifest.ts";
import { translateValue } from "./french-dom.ts";
import { lineGroupSummary } from "./line-pieces.ts";
import { piecesDraftTotalCents, readPickupFeeInput } from "./piece-drafts.ts";
import {
  editPriceRequest,
  groupPayment,
  updateWaitingPackageRequest,
  waitingDraftTotalCents,
  waitingPackageDraftFromRow,
} from "./waiting-packages.ts";

// Owner decision 2026-10-18: a collected request's pickup fee is the line's
// own amount, never spread into the piece prices. Barrel $90 · Box $40 ·
// Pickup fee $20 · Total $150 (the same numbers as the server's and the
// app's suites).
const collected = {
  id: "L1",
  trackingCode: "CL-K7M4P2",
  containerId: "",
  containerStatus: "waiting",
  kind: "other",
  quantity: 2,
  ownerKind: "customer",
  customerName: "Fatou Diallo",
  customerPhone: "+16465550100",
  receiverName: "Mariama Bah",
  receiverPhone: "+224620000000",
  destinationCountryId: "gn",
  destinationCountryName: "Guinea",
  pieces: [
    { id: "p1", kind: "barrel", description: "", sizeIn: null, priceCents: 9000 },
    { id: "p2", kind: "box", description: "Clothes", sizeIn: null, priceCents: 4000 },
  ],
  pickupFeeCents: 2000,
  priceCents: 15000,
  paidCents: 0,
  source: "request",
};

test("the edit form opens on the pieces and the fee apart, and keeps the total", () => {
  const draft = containerLineDraftFromRow(collected);
  assert.equal(draft.pickupFee, "20");
  assert.deepEqual(draft.pieces.map((p) => p.price), ["90", "40"]);
  assert.equal(piecesDraftTotalCents(draft.pieces), 13000);
  assert.equal(piecesDraftTotalCents(draft.pieces, 2000), 15000);
  const payload = containerLinePayload(draft);
  assert.equal(payload.pickupFeeCents, 2000);
  assert.deepEqual(payload.pieces?.map((p) => p.priceCents), [9000, 4000]);
  assert.deepEqual(validateContainerLineDraft(draft), []);
  assert.deepEqual(validateContainerLineDraft({ ...draft, pickupFee: "-1" }), ["pickup_fee_invalid"]);
  assert.equal(containerLinePayload({ ...draft, pickupFee: "25" }).pickupFeeCents, 2500);
  assert.equal(containerLinePayload({ ...draft, pickupFee: "" }).pickupFeeCents, 0);
});

test("a counter line, a part or a legacy line shows no fee field and sends none", () => {
  const counter = { ...collected, pickupFeeCents: undefined, priceCents: 13000, source: "counter" };
  const draft = containerLineDraftFromRow(counter);
  assert.equal(draft.pickupFee, null);
  assert.equal("pickupFeeCents" in containerLinePayload(draft), false);
  const legacy = containerLineDraftFromRow({ ...collected, pieces: undefined, kind: "barrels", quantity: 2, priceCents: 20000 });
  assert.equal(legacy.pickupFee, null);
  // A collected request's line with a zero fee still offers the field.
  assert.equal(containerLineDraftFromRow({ ...collected, pickupFeeCents: 0, priceCents: 13000 }).pickupFee, "0");
});

test("the waiting edit keeps the fee inside its total, so the price call spreads nothing", () => {
  const draft = waitingPackageDraftFromRow(collected);
  assert.equal(draft.pickupFee, "20");
  assert.equal(waitingDraftTotalCents(draft), 15000);
  // Regression: a total without the fee would read as a price drop and the
  // server would spread it over the pieces.
  const price = editPriceRequest("biz", "L1", collected, { ...draft, payOnArrival: true });
  assert.equal(price?.priceCents, 15000);
  const request = updateWaitingPackageRequest("biz", "L1", { ...draft, pickupFee: "25" }, collected);
  assert.equal(request.line.pickupFeeCents, 2500);
});

test("group money counts the fee once, on the root", () => {
  const root = { ...collected, pieces: [collected.pieces[0]], priceCents: 11000, rootLineId: "L1", partIndex: 1, paidCents: 5000 };
  const part = { ...collected, id: "L2", pieces: [collected.pieces[1]], pickupFeeCents: undefined, priceCents: 4000, rootLineId: "L1", partIndex: 2 };
  const group = lineGroupSummary([{ id: "L1", line: root }, { id: "L2", line: part }], "L1");
  assert.equal(group.priceCents, 15000);
  assert.equal(group.pickupFeeCents, 2000);
  assert.deepEqual(groupPayment(group).balanceCents, 10000);
});

test("a typed fee reads like any money, and its words are in French", () => {
  assert.deepEqual(readPickupFeeInput("20,00"), { cents: 2000, error: null });
  assert.deepEqual(readPickupFeeInput(""), { cents: 0, error: null });
  assert.deepEqual(readPickupFeeInput("-3"), { cents: 0, error: "pickup_fee_invalid" });
  assert.deepEqual(readPickupFeeInput("abc").error, "pickup_fee_invalid");
  for (const english of ["Pickup fee", "Pickup fee ($)", "Includes the pickup fee", CONTAINER_MESSAGES.pickup_fee_invalid, CONTAINER_MESSAGES.price_below_pickup_fee]) {
    assert.notEqual(translateValue(english, "fr"), english, `${english} has no French`);
  }
});
