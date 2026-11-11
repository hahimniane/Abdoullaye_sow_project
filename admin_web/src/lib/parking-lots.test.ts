import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  PARKING_LOT_MESSAGES,
  asksForParkingLot,
  defaultParkingLotId,
  emptyParkingLotDraft,
  mainParkingLotId,
  openParkingLots,
  parkingLotBookingRequest,
  parkingLotDraftErrors,
  parkingLotDraftFrom,
  parkingLotIdOf,
  parkingLotIsFull,
  parkingLotMoveRequest,
  parkingLotNameOf,
  parkingLotRefusalText,
  parkingLotSaveRequest,
  sortedParkingLots,
} from "./parking-lots.ts";

const require = createRequire(import.meta.url);
const server = require("../../../my_flutter_app/functions/parking_lots.js");

const rows = [
  { id: "lot-2", businessId: "b1", name: "Lot 2", totalSpaces: 40, sortOrder: 1, addressLine1: "9 Second Street", city: "Bronx" },
  { id: "b1_main", businessId: "b1", name: "Lot 1", totalSpaces: 60, blockedSpaces: 4, isMain: true, sortOrder: 0 },
  { id: "lot-3", businessId: "b1", name: "Lot 3", totalSpaces: 7, sortOrder: 2, active: false },
];
const lots = sortedParkingLots(rows);

test("lots list open ones first, the first lot leading, as the server orders them", () => {
  assert.deepEqual(lots.map((lot) => [lot.id, lot.open]), [["b1_main", true], ["lot-2", true], ["lot-3", false]]);
  assert.deepEqual(openParkingLots(lots).map((lot) => lot.id), server.openLots(rows).map((lot: { id: string }) => lot.id));
  assert.equal(lots[0].blockedSpaces, 4);
  assert.deepEqual(sortedParkingLots(null), []);
});

test("a car with no lot stands in the business's first lot, on both sides", () => {
  assert.equal(mainParkingLotId("b1"), server.mainLotId("b1"));
  for (const car of [{}, { parkingLotId: "" }, { parkingLotId: "lot-2" }, { businessId: "b1" }]) {
    assert.equal(parkingLotIdOf(car, "b1"), server.lotIdOfCar(car, "b1"));
  }
  assert.equal(parkingLotNameOf({}, "b1", lots), "Lot 1");
  assert.equal(parkingLotNameOf({ parkingLotId: "lot-2", parkingLotName: "Old name" }, "b1", lots), "Lot 2");
  // A business with no lots listed: the copy the car carries, or nothing.
  assert.equal(parkingLotNameOf({ parkingLotId: "x", parkingLotName: "Lot 9" }, "b1", []), "Lot 9");
  assert.equal(parkingLotNameOf({}, "b1", []), "");
});

test("staff are asked for a lot only with two or more open lots, opening on their last one", () => {
  assert.equal(asksForParkingLot(lots), true);
  assert.equal(asksForParkingLot(lots.slice(0, 1)), false);
  assert.equal(asksForParkingLot([lots[0], lots[2]]), false);
  assert.equal(asksForParkingLot([]), false);
  assert.equal(defaultParkingLotId(lots, "b1", "lot-2"), "lot-2");
  assert.equal(defaultParkingLotId(lots, "b1", ""), "b1_main");
  // A remembered lot that has since closed is not offered.
  assert.equal(defaultParkingLotId(lots, "b1", "lot-3"), "b1_main");
  assert.equal(defaultParkingLotId([], "b1", "lot-2"), "b1_main");
  // A remembered lot that is full is skipped for one with room; with every
  // lot full the remembered one stays, and the server says it is full.
  const told = (lotId: string, used: number, total: number) => ({ lotId, name: lotId, open: true, isMain: false,
    totals: { inLot: used, reserved: 0, left: 0, collected: 0, owed: 0, spacesTotal: total, spacesUsed: used },
    month: { key: "2026-11", arrived: 0, left: 0, collectedCents: 0 } });
  assert.equal(parkingLotIsFull(told("x", 2, 2)), true);
  assert.equal(parkingLotIsFull(told("x", 1, 2)), false);
  assert.equal(parkingLotIsFull(told("x", 3, 0)), false);
  assert.equal(parkingLotIsFull(null), false);
  assert.equal(defaultParkingLotId(lots, "b1", "lot-2", [told("lot-2", 2, 2), told("b1_main", 1, 60)]), "b1_main");
  assert.equal(defaultParkingLotId(lots, "b1", "lot-2", [told("lot-2", 1, 2)]), "lot-2");
  assert.equal(defaultParkingLotId(lots, "b1", "lot-2", [told("lot-2", 2, 2), told("b1_main", 60, 60)]), "lot-2");
});

test("what the owner types is checked as the server checks it", () => {
  const cases = [
    { name: "Lot 4", totalSpaces: "10", blockedSpaces: "" },
    { name: "", totalSpaces: "10", blockedSpaces: "" },
    { name: "lot 1", totalSpaces: "10", blockedSpaces: "" },
    { name: "Lot 4", totalSpaces: "", blockedSpaces: "" },
    { name: "Lot 4", totalSpaces: "-1", blockedSpaces: "" },
    { name: "Lot 4", totalSpaces: "1.5", blockedSpaces: "" },
    { name: "Lot 4", totalSpaces: "2", blockedSpaces: "3" },
  ];
  for (const typed of cases) {
    const draft = { ...emptyParkingLotDraft, ...typed };
    const serverErrors = server.normalizeLot(
      { ...typed, totalSpaces: typed.totalSpaces === "" ? "" : Number(typed.totalSpaces), blockedSpaces: typed.blockedSpaces === "" ? "" : Number(typed.blockedSpaces) },
      { lots: rows, lotId: "" },
    ).errors;
    assert.deepEqual(parkingLotDraftErrors(draft, lots), serverErrors, JSON.stringify(typed));
  }
  // Renaming a lot to its own name is not a clash.
  assert.deepEqual(parkingLotDraftErrors({ ...emptyParkingLotDraft, name: "Lot 1", totalSpaces: "5" }, lots, "b1_main"), []);
});

test("the refusals read the same on both sides, and every one has French", () => {
  assert.deepEqual(PARKING_LOT_MESSAGES, { ...server.LOT_MESSAGES });
  assert.equal(parkingLotRefusalText({ details: { reason: "lot_full" } }), "That lot is full. Choose another lot.");
  assert.equal(parkingLotRefusalText({ details: { reason: "something_else" } }), "");
  assert.equal(parkingLotRefusalText(null), "");
  const french = readFileSync("src/lib/french-dom.ts", "utf8");
  for (const sentence of Object.values(PARKING_LOT_MESSAGES)) {
    assert.ok(french.includes(JSON.stringify(sentence) + ":") || french.includes(`"${sentence}":`), sentence);
  }
});

test("the requests name the action the server routes", () => {
  const draft = { ...parkingLotDraftFrom(lots[1]), totalSpaces: "45" };
  assert.deepEqual(parkingLotSaveRequest("b1", draft, "lot-2"), {
    action: "lot_save", businessId: "b1", lotId: "lot-2",
    lot: { name: "Lot 2", addressLine1: "9 Second Street", city: "Bronx", state: "", zipCode: "", totalSpaces: 45, blockedSpaces: 0, active: true },
  });
  assert.equal("lotId" in parkingLotSaveRequest("b1", emptyParkingLotDraft), false);
  assert.deepEqual(parkingLotMoveRequest("car-1", "lot-2"), { action: "lot_move", entryId: "car-1", parkingLotId: "lot-2" });
  assert.deepEqual(parkingLotBookingRequest("b1", "lot-2"), { action: "lot_booking", businessId: "b1", lotId: "lot-2" });
  const source = readFileSync("../my_flutter_app/functions/index.js", "utf8");
  assert.match(source, /const PARKING_LOT_ACTIONS = Object\.freeze\(\s*\["lot_save", "lot_booking", "lot_move"\]\);/);
});
