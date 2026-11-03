import assert from "node:assert/strict";
import test from "node:test";

import {
  comingToday,
  emptyRouteDraft,
  laawolLinesOf,
  listDraftFrom,
  listPayload,
  listProblem,
  newItemDraft,
  pieceNeedsWeight,
  piecePriceOf,
  plannedDepartureText,
  plannedWindowOf,
  priceBasisText,
  priceListFailure,
  priceListHistory,
  priceListView,
  readWeightLb,
  routeDraftFrom,
  routePayload,
  weighedPriceInput,
  windowText,
} from "./business-price-list.ts";
import { PRICE_LIST_MESSAGES, validatePriceList } from "./package-price-list.ts";

const stored = {
  items: [
    { id: "i_phone", categoryId: "electronics", label: "Phone", priceCents: 4000, includedLb: 2 },
    { id: "i_tv", categoryId: "fragile", label: "TV", priceCents: 12050, includedLb: 0 },
  ],
  perLbCents: { clothing: 600, general: 450 },
  departure: { weekdays: ["tue", "fri"], everyWeeks: 2, anchorDate: "2026-11-07" },
};

test("a stored route round-trips through the editor to the same route", () => {
  const draft = routeDraftFrom(stored);
  assert.equal(draft.items[0].price, "40");
  assert.equal(draft.items[1].price, "120.50");
  assert.equal(draft.items[1].includedLb, "");
  assert.equal(draft.rates.clothing, "6");
  const payload = routePayload(draft);
  const { routes, errors } = validatePriceList({ routes: { gn: { sea: payload } } }, ["gn"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(routes?.gn.sea, stored);
});

test("French typing: a comma reads as the decimal mark", () => {
  const draft = routeDraftFrom(stored, "fr");
  assert.equal(draft.items[1].price, "120,50");
  assert.equal(routePayload(draft)?.items && (routePayload(draft)?.items as { priceCents: number }[])[1].priceCents, 12050);
});

test("a blank row is dropped, an empty draft sends nothing", () => {
  const draft = emptyRouteDraft();
  draft.items.push(newItemDraft());
  assert.equal(routePayload(draft), null);
  assert.deepEqual(listPayload({ gn: { sea: draft, air: emptyRouteDraft() } }), { routes: {} });
});

test("the whole map goes: every country, only its priced modes", () => {
  const list = listDraftFrom({ gn: { air: { items: [], perLbCents: { food: 500 }, departure: null } } }, ["gn", "sn"]);
  const payload = listPayload(list);
  assert.deepEqual(Object.keys(payload.routes), ["gn"]);
  assert.deepEqual(Object.keys(payload.routes.gn), ["air"]);
  assert.equal(listProblem(list), "");
});

test("problems come out as the server's reason codes", () => {
  const list = listDraftFrom({}, ["gn"]);
  const row = newItemDraft();
  row.label = "Phone";
  row.price = "abc";
  list.gn.sea.items.push(row);
  assert.equal(listProblem(list), "price_invalid");
  row.price = "40";
  assert.equal(listProblem(list), "");
  list.gn.sea.items.push({ ...newItemDraft(), label: "phone", price: "5" });
  assert.equal(listProblem(list), "label_duplicate");
  list.gn.sea.items.pop();
  list.gn.sea.departure = { days: ["mon"], everyWeeks: "2", anchorDate: "" };
  assert.equal(listProblem(list), "departure_invalid");
});

test("a refusal reads as the server's sentence; anything else is generic", () => {
  const known = priceListFailure({ code: "functions/invalid-argument", details: { reason: "label_required", reasons: ["label_required"] } });
  assert.equal(known.reason, "label_required");
  assert.equal(known.message, PRICE_LIST_MESSAGES.label_required);
  assert.equal(priceListFailure(new Error("boom")).message, "Something went wrong. Try again.");
  assert.match(priceListFailure({ code: "functions/permission-denied" }).message, /owner/);
  assert.match(priceListFailure({ code: "functions/unavailable" }).message, /connection/);
});

test("the stored list: view and history, newest first", () => {
  const doc = {
    routes: { gn: { sea: stored, air: null }, xx: {} },
    needsCheck: true,
    updatedByLaawol: true,
    history: [
      { atMs: 100, byName: "Ada", action: "saved", countries: ["gn"] },
      { atMs: 300, byName: "Laawol", byLaawol: true, action: "saved", countries: ["gn", "sn"] },
      { atMs: 200, byName: "Ada", action: "checked", countries: [] },
      { byName: "no time" },
    ],
  };
  const view = priceListView(doc);
  assert.equal(view.needsCheck, true);
  assert.deepEqual(Object.keys(view.routes), ["gn"]);
  assert.deepEqual(Object.keys(view.routes.gn), ["sea"]);
  const history = priceListHistory(doc);
  assert.deepEqual(history.map((h) => h.atMs), [300, 200, 100]);
  assert.equal(history[0].byLaawol, true);
  assert.equal(history[1].action, "checked");
});

test("window text: US 12-hour, one AM/PM when shared; French 24-hour", () => {
  assert.equal(windowText({ from: "14:00", to: "16:00" }), "2:00–4:00 PM");
  assert.equal(windowText({ from: "11:00", to: "13:00" }), "11:00 AM–1:00 PM");
  assert.equal(windowText({ from: "09:30", to: "11:30" }), "9:30–11:30 AM");
  assert.equal(windowText({ from: "00:00", to: "02:00" }), "12:00–2:00 AM");
  assert.equal(windowText({ from: "14:00", to: "16:00" }, "fr"), "14 h–16 h");
  assert.equal(windowText({ from: "14:30", to: "16:30" }, "fr"), "14 h 30–16 h 30");
  assert.equal(windowText(null), "");
  assert.deepEqual(plannedWindowOf({ from: "14:00", to: "16:00" }), { from: "14:00", to: "16:00" });
  assert.equal(plannedWindowOf({ from: "2pm", to: "4pm" }), null);
});

test("coming today: confirmed bring-ins planned today, soonest window first", () => {
  const rows = [
    { id: "c", status: "confirmed", handoff: "bring_in", plannedDate: "2026-11-03", plannedWindow: { from: "16:00", to: "18:00" } },
    { id: "a", status: "confirmed", handoff: "bring_in", plannedDate: "2026-11-03", plannedWindow: { from: "09:00", to: "11:00" } },
    { id: "d", status: "confirmed", handoff: "bring_in", plannedDate: "2026-11-03" },
    { id: "e", status: "confirmed", handoff: "bring_in", plannedDate: "2026-11-04", plannedWindow: { from: "08:00", to: "10:00" } },
    { id: "f", status: "new", handoff: "bring_in", plannedDate: "2026-11-03", plannedWindow: { from: "08:00", to: "10:00" } },
    { id: "g", status: "confirmed", handoff: "collect", plannedDate: "2026-11-03" },
  ];
  assert.deepEqual(comingToday(rows, "2026-11-03").map((r) => r.id), ["a", "c", "d"]);
  assert.deepEqual(comingToday([], "2026-11-03"), []);
});

test("planned departure reads as a day", () => {
  assert.equal(plannedDepartureText("2026-11-14"), "Planned to leave Sat, Nov 14");
  assert.equal(plannedDepartureText("2026-11-14", "fr"), "Départ prévu sam. 14 nov.");
  assert.equal(plannedDepartureText(""), "");
  assert.equal(plannedDepartureText("2026-02-30"), "");
});

test("weighing a priced piece at the counter", () => {
  const phone = piecePriceOf({
    price: { source: "item", itemId: "i_phone", quantity: 1, unitCents: 4000, includedLb: 2, excessPerLbCents: 450 },
  });
  assert.equal(pieceNeedsWeight(phone), true);
  assert.equal(weighedPriceInput(phone, "2"), "40");
  assert.equal(weighedPriceInput(phone, "6"), "58");
  assert.equal(weighedPriceInput(phone, "6.5"), "60.25");
  assert.equal(weighedPriceInput(phone, "abc"), null);
  const clothes = piecePriceOf({ price: { source: "per_lb", perLbCents: 600, weightLb: 50 } });
  assert.equal(weighedPriceInput(clothes, "52,5", "fr"), "315");
  const noRate = piecePriceOf({
    price: { source: "item", unitCents: 4000, quantity: 1, includedLb: 2, excessPerLbCents: null },
  });
  assert.equal(weighedPriceInput(noRate, "5"), null);
  const laptop = piecePriceOf({ price: { source: "item", unitCents: 7000, quantity: 1, includedLb: 0 } });
  assert.equal(pieceNeedsWeight(laptop), false);
  assert.equal(pieceNeedsWeight(piecePriceOf({ price: null })), false);
  assert.equal(readWeightLb("0"), null);
  assert.equal(readWeightLb("3000"), null);
  assert.equal(readWeightLb("12.34"), 12.3);
});

test("the weigh-in line names what the price is based on", () => {
  const phone = piecePriceOf({
    price: { source: "item", unitCents: 4000, quantity: 1, includedLb: 2, excessPerLbCents: 450 },
  });
  assert.equal(priceBasisText(phone), "$40 covers up to 2 lb, then $4.50/lb");
  assert.equal(priceBasisText(phone, "fr"), "$40 couvre jusqu’à 2 lb, puis $4,50/lb");
  assert.equal(priceBasisText(piecePriceOf({ price: { source: "per_lb", perLbCents: 600 } })), "$6/lb");
});

test("Found on Laawol: older rollups count as zero", () => {
  assert.equal(laawolLinesOf({ laawolLines: 4 }), 4);
  assert.equal(laawolLinesOf({}), 0);
  assert.equal(laawolLinesOf(null), 0);
});
