import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  NO_FILTERS,
  addOtherLine,
  addWeightLine,
  airOffered,
  applySizePreset,
  barrelQuantity,
  basketFor,
  buildCatalog,
  businessesCountText,
  canReschedule,
  catalogWeightUnit,
  chooseCountry,
  chooseHandoff,
  chooseMode,
  compareRows,
  dayChoices,
  departureText,
  emptySendDraft,
  handoffProblems,
  includedLbText,
  itemKey,
  itemQuantity,
  itemsProblems,
  listPriceCents,
  modeOptions,
  parseWindow,
  peopleProblems,
  pickupFeeText,
  pickupQuotePayload,
  pickupQuotePayloads,
  pickupWindowText,
  pieceCount,
  piecesCountText,
  piecesFor,
  priceExplanation,
  ratingText,
  readWeight,
  requestPlanText,
  reschedulePayload,
  sentView,
  setBarrelQuantity,
  setItemQuantity,
  setWeightUnit,
  submitPayload,
  totalText,
  typeWeight,
  visibleRows,
  whenProblems,
  whenText,
  windowFits,
  windowSlots,
  windowText,
  windowsForDay,
  type BasketLine,
  type PickupQuote,
  type SendDraft,
} from "./package-compare.ts";
import { REQUEST_ERROR_MESSAGES, type RequestOption, type WeekHours } from "./package-requests.ts";

const WEEK: WeekHours = {
  mon: { open: true, from: "09:00", to: "18:00" },
  tue: { open: true, from: "09:00", to: "18:00" },
  wed: { open: true, from: "09:00", to: "18:00" },
  thu: { open: true, from: "09:00", to: "18:00" },
  fri: { open: true, from: "09:00", to: "18:00" },
  sat: { open: true, from: "10:00", to: "14:00" },
  sun: { open: false, from: "09:00", to: "18:00" },
};

// Tuesday, Nov 3 2026, 12:00 noon in New York.
const NOW = Date.UTC(2026, 10, 3, 17, 0, 0);

const NO_DEPARTURE = { dateKey: "", source: "none" as const, approximate: false };

function option(extra: Partial<RequestOption> & { businessId: string; businessName: string }): RequestOption {
  return {
    businessPhone: "+16465550199",
    profileImageUrl: "",
    slug: extra.businessId,
    country: { id: "guinea", name: "Guinea" },
    barrelPriceCents: null,
    cardBarrelBooking: false,
    bringIn: { available: true, locations: [{ id: "bronx", label: "Bronx", address: "410 E 138th St", hours: WEEK }] },
    collect: { available: false, areas: "" },
    timeZone: "America/New_York",
    routes: { sea: null, air: null },
    departures: { sea: NO_DEPARTURE, air: NO_DEPARTURE },
    shipsByAir: false,
    rating: null,
    reviewCount: 0,
    coversLoss: false,
    pickupPricing: null,
    ...extra,
  };
}

const PHONE_A = { id: "i_phone", categoryId: "electronics", label: "Phone", priceCents: 4000, includedLb: 2 };
const TV_A = { id: "i_tv", categoryId: "electronics", label: "TV", priceCents: 12000, includedLb: 0 };
const PHONE_B = { id: "i_phone_any", categoryId: "electronics", label: "phone", priceCents: 4500, includedLb: 0 };

const DALA = option({
  businessId: "dala",
  businessName: "Dala Shipping",
  barrelPriceCents: 15000,
  collect: { available: true, areas: "Bronx" },
  routes: {
    sea: { items: [PHONE_A, TV_A], perLbCents: { clothing: 600 } },
    air: { items: [{ ...PHONE_A, id: "i_phone", priceCents: 9000 }], perLbCents: { general: 900 } },
  },
  departures: {
    sea: { dateKey: "2026-11-22", source: "schedule", approximate: true },
    air: { dateKey: "2026-11-07", source: "planned", approximate: false },
  },
  shipsByAir: true,
  rating: 4.6,
  reviewCount: 23,
  coversLoss: true,
});

const BRONX = option({
  businessId: "bronx",
  businessName: "Bronx Cargo",
  barrelPriceCents: 14000,
  routes: { sea: { items: [PHONE_B], perLbCents: {} }, air: null },
  departures: { sea: { dateKey: "2026-11-10", source: "schedule", approximate: false }, air: NO_DEPARTURE },
});

const SENEGAL = option({ businessId: "sn", businessName: "Dakar Express", country: { id: "senegal", name: "Senegal" } });

const OPTIONS = [DALA, BRONX, SENEGAL];

test("only Air-capable businesses are offered for Air, per country", () => {
  assert.deepEqual(modeOptions(OPTIONS, "guinea", "sea").map((o) => o.businessId), ["bronx", "dala"]);
  assert.deepEqual(modeOptions(OPTIONS, "guinea", "air").map((o) => o.businessId), ["dala"]);
  assert.equal(airOffered(OPTIONS, "guinea"), true);
  assert.equal(airOffered(OPTIONS, "senegal"), false);
  // A server that predates price lists sends no shipsByAir: Air is not offered.
  assert.equal(airOffered([{ ...DALA, shipsByAir: undefined }], "guinea"), false);
});

test("the catalog is the union of what the businesses price, plus per-pound categories and the barrel", () => {
  const sea = buildCatalog(modeOptions(OPTIONS, "guinea", "sea"), "sea");
  // "Phone" and "phone" are one item (same category and name, ignoring case); the weight limits are a range.
  assert.deepEqual(sea.items.map((i) => [i.key, i.label, i.minIncludedLb, i.maxIncludedLb]), [
    ["electronics|phone", "Phone", 0, 2],
    ["electronics|tv", "TV", 0, 0],
  ]);
  assert.deepEqual(sea.categories, ["clothing"]);
  assert.equal(sea.barrel, true);
  assert.equal(includedLbText(sea.items[0], "en"), "up to 2 lb each");
  assert.equal(includedLbText(sea.items[1], "en"), "");
  const air = buildCatalog(modeOptions(OPTIONS, "guinea", "air"), "air");
  assert.deepEqual(air.items.map((i) => i.label), ["Phone"]);
  assert.deepEqual(air.categories, ["general"]);
  // No barrel by air.
  assert.equal(air.barrel, false);
  // Nobody priced anything for Senegal: only "something else" is left.
  assert.deepEqual(buildCatalog(modeOptions(OPTIONS, "senegal", "sea"), "sea"), { items: [], categories: [], barrel: false });
  assert.equal(itemKey("electronics", " Phone "), "electronics|phone");
});

test("quantities, barrels and weights build the basket the server will price", () => {
  const phone = { key: "electronics|phone", label: "Phone", categoryId: "electronics" };
  let lines: BasketLine[] = [];
  lines = setItemQuantity(lines, phone, 2);
  assert.equal(itemQuantity(lines, phone.key), 2);
  lines = setItemQuantity(lines, phone, 99);
  assert.equal(itemQuantity(lines, phone.key), 50);
  lines = setItemQuantity(lines, phone, 2);
  lines = setBarrelQuantity(lines, 3);
  assert.equal(barrelQuantity(lines), 3);
  // A barrel each, one piece for an item whatever its quantity.
  assert.equal(pieceCount(lines), 4);
  lines = addWeightLine(lines, "clothing");
  assert.equal(pieceCount(lines), 5);
  assert.deepEqual(itemsProblems(lines), ["weight_invalid"]);
  const weight = lines[lines.length - 1] as Extract<BasketLine, { type: "weight" }>;
  const suitcase = applySizePreset(weight, "suitcase");
  assert.equal(suitcase.weightLb, "50");
  assert.equal(suitcase.sizePreset, "suitcase");
  // Typing another number drops the preset; typing the same number keeps it.
  assert.equal(typeWeight(suitcase, "45").sizePreset, "");
  assert.equal(typeWeight(suitcase, "50").sizePreset, "suitcase");
  assert.equal(readWeight("10,5"), 10.5);
  assert.equal(readWeight("0"), null);
  assert.equal(readWeight("2001"), null);
  assert.equal(readWeight("abc"), null);
  lines = lines.map((line) => (line.key === weight.key ? suitcase : line));
  assert.deepEqual(itemsProblems(lines), []);
  lines = setItemQuantity(lines, phone, 0);
  assert.equal(itemQuantity(lines, phone.key), 0);
  lines = setBarrelQuantity(lines, 0);
  assert.equal(barrelQuantity(lines), 0);
  assert.deepEqual(itemsProblems([]), ["pieces_required"]);
  assert.deepEqual(itemsProblems(setBarrelQuantity([], 20).concat(addOtherLine([]))), ["too_many_pieces", "piece_description_required"]);
  const badPhoto = { ...(addOtherLine([])[0] as Extract<BasketLine, { type: "other" }>), description: "TV", photos: [{ key: "k", path: "", previewUrl: "", status: "error" as const }] };
  assert.deepEqual(itemsProblems([badPhoto]), ["photo_invalid"]);
});

const BASKET: BasketLine[] = [
  { key: "a", type: "item", catalogKey: "electronics|phone", label: "Phone", categoryId: "electronics", quantity: 2 },
  { key: "b", type: "weight", categoryId: "clothing", weightLb: "50", weightUnit: "lb", sizePreset: "suitcase" },
  { key: "c", type: "barrel", quantity: 1 },
  { key: "d", type: "other", kind: "box", description: " Generator ", photos: [
    { key: "p1", path: "packageRequestPhotos/dala/u/a.jpg", previewUrl: "", status: "ready" },
    { key: "p2", path: "", previewUrl: "", status: "ready" },
    { key: "p3", path: "x", previewUrl: "", status: "error" },
  ] },
];

test("each business is asked for its own item ids; what it does not price waits for a staff estimate", () => {
  assert.deepEqual(piecesFor(BASKET, DALA, "sea"), [
    { priceItemId: "i_phone", quantity: 2, label: "Phone" },
    { categoryId: "clothing", weightLb: 50, weightUnit: "lb", sizePreset: "suitcase" },
    { kind: "barrel" },
    { kind: "box", description: "Generator", photoPaths: ["packageRequestPhotos/dala/u/a.jpg"] },
  ]);
  const bronx = piecesFor(BASKET, BRONX, "sea");
  assert.deepEqual(bronx[0], { priceItemId: "i_phone_any", quantity: 2, label: "phone" });
  // Bronx Cargo prices no TV: an item it lacks is a described piece.
  const tv: BasketLine[] = [{ key: "t", type: "item", catalogKey: "electronics|tv", label: "TV", categoryId: "electronics", quantity: 3 }];
  assert.deepEqual(piecesFor(tv, BRONX, "sea"), [{ kind: "other", description: "3 × TV" }]);
});

test("the total is today's list price: 'about' when weighed, 'to quote' when partly priced", () => {
  const rows = compareRows(OPTIONS, { countryId: "guinea", mode: "sea", lines: BASKET, handoff: "bring_in", quotes: [] });
  const dala = rows.find((r) => r.businessId === "dala")!;
  const bronx = rows.find((r) => r.businessId === "bronx")!;
  // 2 phones $80 + 50 lb clothes $300 + a barrel $150 + the generator waits for a quote.
  assert.equal(dala.allPriced, false);
  assert.equal(dala.pricedCents, 8000 + 30000 + 15000);
  assert.equal(dala.piecesToQuote, 1);
  assert.equal(dala.weighsAtCounter, true);
  assert.equal(totalText(dala, "en"), "about $530.00 + 1 to quote");
  assert.equal(totalText(dala, "fr"), "environ 530,00 $ + 1 à estimer");
  // Bronx prices phones and the barrel; the weighed clothes and the generator are to quote.
  assert.equal(bronx.pricedCents, 9000 + 14000);
  assert.equal(bronx.piecesToQuote, 2);
  assert.equal(totalText(bronx, "en"), "$230.00 + 2 to quote");
  // A basket every piece of which is priced is a plain total ("about" because phones are weighed).
  const priced = BASKET.slice(0, 3);
  const full = compareRows([DALA], { countryId: "guinea", mode: "sea", lines: priced, handoff: "bring_in", quotes: [] })[0];
  assert.equal(full.allPriced, true);
  assert.equal(full.totalCents, 53000);
  assert.equal(totalText(full, "en"), "about $530.00");
  const barrelOnly = compareRows([DALA], { countryId: "guinea", mode: "sea", lines: [BASKET[2]], handoff: "bring_in", quotes: [] })[0];
  assert.equal(totalText(barrelOnly, "en"), "$150.00");
  // Nothing priced at all.
  const nothing = compareRows([SENEGAL], { countryId: "senegal", mode: "sea", lines: [BASKET[3]], handoff: "bring_in", quotes: [] })[0];
  assert.equal(totalText(nothing, "en"), "Price on request");
  assert.equal(totalText(nothing, "fr"), "Prix sur demande");
  assert.equal(basketFor(DALA, priced, "sea").totalCents, 53000);
  // The same basket by air uses the air list: the phone is $90.
  assert.equal(basketFor(DALA, [BASKET[0]], "air").totalCents, 18000);
});

test("pickup: each row carries the business's fee, 'to quote', or is blocked", () => {
  const quotes: PickupQuote[] = [
    { businessId: "dala", available: true, priced: true, feeCents: 2500, distanceMiles: 3, borough: "Bronx", reason: "" },
    { businessId: "far", available: false, priced: false, feeCents: null, distanceMiles: null, borough: "", reason: "pickup_out_of_range" },
  ];
  const far = option({ businessId: "far", businessName: "Far Away", collect: { available: true, areas: "NJ" }, routes: { sea: { items: [PHONE_A], perLbCents: {} }, air: null } });
  const noPlan = option({ businessId: "noplan", businessName: "No Plan", collect: { available: true, areas: "Queens" }, routes: { sea: { items: [PHONE_A], perLbCents: {} }, air: null } });
  const lines = [BASKET[0]];
  const rows = compareRows([DALA, BRONX, far, noPlan], { countryId: "guinea", mode: "sea", lines, handoff: "collect", quotes });
  // Bronx Cargo does not pick up at all: not a row.
  assert.deepEqual(rows.map((r) => r.businessId).sort(), ["dala", "far", "noplan"]);
  const dala = rows.find((r) => r.businessId === "dala")!;
  assert.equal(dala.pickupFeeCents, 2500);
  assert.equal(dala.totalCents, 8000 + 2500);
  assert.equal(pickupFeeText(dala, "en"), "$25.00");
  assert.equal(rows.find((r) => r.businessId === "far")!.blocked, true);
  const noplan = rows.find((r) => r.businessId === "noplan")!;
  assert.equal(noplan.pickupToQuote, true);
  assert.equal(noplan.allPriced, false);
  assert.equal(noplan.totalCents, null);
  assert.equal(totalText(noplan, "en"), "about $80.00 + pickup fee to quote");
  assert.equal(pickupFeeText(noplan, "en"), "to quote");
  // Blocked rows come last and cannot be chosen; the rest are ranked, a known fee first.
  const { shown, blocked } = visibleRows(rows, "best", NO_FILTERS);
  assert.deepEqual(shown.map((r) => r.businessId), ["dala", "noplan"]);
  assert.deepEqual(blocked.map((r) => r.businessId), ["far"]);
  // The drop-off list only has businesses with drop-off hours.
  const noBring = { ...DALA, bringIn: { available: false, locations: [] } };
  assert.deepEqual(compareRows([noBring, BRONX], { countryId: "guinea", mode: "sea", lines, handoff: "bring_in", quotes: [] }).map((r) => r.businessId), ["bronx"]);
  assert.deepEqual(pickupQuotePayload(" 12 Grand Concourse ", [DALA, BRONX, far], "guinea", "sea"), { action: "pickup_quote", address: "12 Grand Concourse", businessIds: ["dala", "far"] });
  const many = Array.from({ length: 45 }, (_, i) => ({ ...far, businessId: `b${i}` }));
  const chunks = pickupQuotePayloads("1 Main St", many, "guinea", "sea");
  assert.deepEqual(chunks.map((c) => c.businessIds.length), [20, 20, 5]);
});

test("sorting and filtering the comparison", () => {
  const lines: BasketLine[] = [BASKET[2]];
  const cheap = option({ businessId: "cheap", businessName: "Cheap", barrelPriceCents: 10000, rating: null, reviewCount: 0, departures: { sea: { dateKey: "2026-12-01", source: "schedule", approximate: false }, air: NO_DEPARTURE } });
  const star = option({ businessId: "star", businessName: "Star", barrelPriceCents: 16000, rating: 4.9, reviewCount: 40, coversLoss: true, departures: { sea: { dateKey: "2026-11-05", source: "planned", approximate: false }, air: NO_DEPARTURE } });
  const unpriced = option({ businessId: "unp", businessName: "Unpriced", barrelPriceCents: null, rating: 5, reviewCount: 2 });
  const rows = compareRows([cheap, star, unpriced], { countryId: "guinea", mode: "sea", lines, handoff: "bring_in", quotes: [] });
  const ids = (sort: "best" | "price" | "rating" | "soonest", filters = NO_FILTERS) => visibleRows(rows, sort, filters).shown.map((r) => r.businessId);
  // Everything priced first, lowest total first; the business that must quote is last.
  assert.deepEqual(ids("best"), ["cheap", "star", "unp"]);
  assert.deepEqual(ids("price"), ["cheap", "star", "unp"]);
  // Highest rating first (5.0 from two reviews beats 4.9 from forty); unrated last.
  assert.deepEqual(ids("rating"), ["unp", "star", "cheap"]);
  assert.deepEqual(ids("soonest"), ["star", "cheap", "unp"]);
  assert.deepEqual(ids("best", { ...NO_FILTERS, coversLoss: true }), ["star"]);
  assert.deepEqual(ids("best", { ...NO_FILTERS, rated: true }), ["star", "unp"]);
  assert.deepEqual(ids("best", { ...NO_FILTERS, picksUp: true }), []);
});

test("rows are worded: rating, departure and counts, in both languages", () => {
  assert.equal(ratingText(4.6, 23), "★ 4.6 (23)");
  assert.equal(ratingText(null, 0), "");
  const schedule = { dateKey: "2026-11-07", source: "planned" as const, approximate: false };
  assert.equal(departureText(schedule, "air", "en"), "Next flight: Sat, Nov 7");
  assert.equal(departureText(schedule, "sea", "en"), "Next container: Sat, Nov 7");
  assert.equal(departureText({ dateKey: "2026-11-22", source: "schedule", approximate: true }, "sea", "en"), "Next container: around Nov 22");
  assert.equal(departureText({ dateKey: "", source: "unconfirmed", approximate: false }, "sea", "en"), "Departure date not confirmed");
  assert.equal(departureText(NO_DEPARTURE, "sea", "en"), "");
  assert.equal(departureText(schedule, "air", "fr"), "Prochain vol : sam. 7 nov.");
  assert.equal(departureText({ dateKey: "", source: "unconfirmed", approximate: false }, "air", "fr"), "Date de départ non confirmée");
  assert.equal(piecesCountText(1, "en"), "1 piece");
  assert.equal(piecesCountText(4, "en"), "4 pieces");
  assert.equal(businessesCountText(1, "en"), "1 business ships there");
  assert.equal(businessesCountText(3, "en"), "3 businesses ship there");
  assert.equal(businessesCountText(3, "fr"), "3 entreprises expédient vers cette destination");
});

test("two-hour windows: hourly from opening to closing minus two hours", () => {
  assert.deepEqual(windowSlots({ from: "09:00", to: "18:00" }).map((s) => s.value), [
    "09:00-11:00", "10:00-12:00", "11:00-13:00", "12:00-14:00", "13:00-15:00", "14:00-16:00", "15:00-17:00", "16:00-18:00",
  ]);
  // Hours that do not fall on the hour still end the last window at closing.
  const odd = windowSlots({ from: "09:30", to: "18:00" }).map((s) => s.value);
  assert.equal(odd[0], "09:30-11:30");
  assert.equal(odd[odd.length - 1], "16:00-18:00");
  assert.deepEqual(windowSlots({ from: "10:00", to: "14:00" }).map((s) => s.value), ["10:00-12:00", "11:00-13:00", "12:00-14:00"]);
  // Short hours: one shorter window; under 30 minutes: none.
  assert.deepEqual(windowSlots({ from: "10:00", to: "11:00" }).map((s) => s.value), ["10:00-11:00"]);
  assert.deepEqual(windowSlots({ from: "10:00", to: "10:20" }), []);
  assert.deepEqual(windowSlots(null), []);
  // Every window offered passes the server's rule: 30 min to 2 h inside the hours.
  for (const day of [{ from: "09:00", to: "18:00" }, { from: "09:30", to: "18:00" }, { from: "10:00", to: "11:00" }, { from: "08:15", to: "21:45" }]) {
    for (const slot of windowSlots(day)) assert.equal(windowFits(slot.value, day), true, `${day.from}-${day.to} ${slot.value}`);
  }
  assert.equal(windowFits("09:00-12:00", { from: "09:00", to: "18:00" }), false);
  assert.equal(windowFits("09:00-09:20", { from: "09:00", to: "18:00" }), false);
  assert.equal(windowFits("08:00-10:00", { from: "09:00", to: "18:00" }), false);
  assert.equal(windowFits("17:00-19:00", { from: "09:00", to: "18:00" }), false);
  assert.equal(windowFits({ from: "14:00", to: "16:00" }, { from: "09:00", to: "18:00" }), true);
  assert.deepEqual(parseWindow("14:00-16:00"), { from: "14:00", to: "16:00" });
  assert.equal(parseWindow("morning"), null);
});

test("a day offers its own windows; today's past windows are hidden; a pickup uses 07:00 to 21:00", () => {
  const today = windowsForDay({ handoff: "bring_in", hours: WEEK, dateKey: "2026-11-03", zone: "America/New_York" }, NOW);
  // It is noon: windows over by noon are gone.
  assert.equal(today[0].value, "11:00-13:00");
  const friday = windowsForDay({ handoff: "bring_in", hours: WEEK, dateKey: "2026-11-06", zone: "America/New_York" }, NOW);
  assert.equal(friday.length, 8);
  assert.deepEqual(windowsForDay({ handoff: "bring_in", hours: WEEK, dateKey: "2026-11-08", zone: "America/New_York" }, NOW), []);
  const pickup = windowsForDay({ handoff: "collect", hours: null, dateKey: "2026-11-06", zone: "America/New_York" }, NOW);
  assert.equal(pickup[0].value, "07:00-09:00");
  assert.equal(pickup[pickup.length - 1].value, "19:00-21:00");
  assert.equal(pickup.length, 13);
});

test("days: today to +60, a closed day is shown and disabled", () => {
  const days = dayChoices(WEEK, "America/New_York", "en", NOW);
  assert.equal(days.length, 61);
  assert.equal(days[0].key, "2026-11-03");
  assert.equal(days[60].key, "2027-01-02");
  const sunday = days.find((d) => d.key === "2026-11-08")!;
  assert.equal(sunday.open, false);
  assert.equal(sunday.label, "Sun, Nov 8 — closed");
  assert.equal(days.find((d) => d.key === "2026-11-06")!.label, "Fri, Nov 6");
  assert.equal(dayChoices(WEEK, "America/New_York", "fr", NOW).find((d) => d.key === "2026-11-08")!.label, "dim. 8 nov. — fermé");
  // A pickup may be on any day.
  assert.equal(dayChoices(null, "America/New_York", "en", NOW, true).every((d) => d.open), true);
});

test("windows and days read US month-first and 12-hour in English", () => {
  assert.equal(windowText("14:00-16:00", "en"), "2–4 PM");
  assert.equal(windowText("09:00-11:00", "en"), "9–11 AM");
  assert.equal(windowText("11:00-13:00", "en"), "11 AM–1 PM");
  assert.equal(windowText("14:30-16:30", "en"), "2:30–4:30 PM");
  assert.equal(windowText("12:00-14:00", "en"), "12–2 PM");
  assert.equal(windowText("14:00-16:00", "fr"), "14 h–16 h");
  assert.equal(windowText("14:30-16:00", "fr"), "14 h 30–16 h");
  assert.equal(windowText("nonsense", "en"), "");
  assert.equal(whenText("2026-11-06", { from: "14:00", to: "16:00" }, "en"), "Fri, Nov 6, 2–4 PM");
  assert.equal(whenText("2026-11-06", "14:00-16:00", "fr"), "ven. 6 nov., 14 h–16 h");
  assert.equal(whenText("2026-11-06", null, "en"), "Fri, Nov 6");
  // A request from before windows had a clock time.
  assert.equal(pickupWindowText("morning", "en"), "Morning");
  assert.equal(pickupWindowText("evening", "fr"), "Soir");
  assert.equal(pickupWindowText("whenever", "en"), "");
});

function filled(extra: Partial<SendDraft> = {}): SendDraft {
  return {
    ...emptySendDraft(),
    countryId: "guinea",
    lines: [BASKET[0]],
    senderName: " Fatou ",
    senderPhone: "+1 646 555 0100",
    receiverName: "Mariama",
    receiverPhone: "+224620000000",
    ...extra,
  };
}

test("the form refuses what the server would, step by step", () => {
  assert.deepEqual(handoffProblems(emptySendDraft()), ["handoff_invalid"]);
  assert.deepEqual(handoffProblems({ handoff: "collect", pickupAddress: " " }), ["pickup_address_required"]);
  assert.deepEqual(handoffProblems({ handoff: "bring_in", pickupAddress: "" }), []);
  assert.deepEqual(peopleProblems(emptySendDraft()), ["sender_name_required", "sender_phone_invalid", "receiver_name_required", "receiver_phone_invalid"]);
  assert.deepEqual(peopleProblems(filled()), []);

  const bring = chooseHandoff(filled(), "bring_in");
  // The only location is chosen for them.
  assert.deepEqual(whenProblems(bring, DALA, NOW), ["planned_date_invalid"]);
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-08", plannedWindow: "09:00-11:00" }, DALA, NOW), ["planned_day_closed"]);
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-02", plannedWindow: "09:00-11:00" }, DALA, NOW), ["planned_date_invalid"]);
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-06" }, DALA, NOW), ["window_invalid"]);
  // A window outside that day's hours (Saturday closes at 14:00).
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-07", plannedWindow: "13:00-15:00" }, DALA, NOW), ["window_invalid"]);
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-07", plannedWindow: "12:00-14:00" }, DALA, NOW), []);
  assert.deepEqual(whenProblems({ ...bring, plannedDate: "2026-11-06", plannedWindow: "14:00-16:00" }, DALA, NOW), []);

  const collect = chooseHandoff(bring, "collect");
  assert.deepEqual(whenProblems(collect, DALA, NOW), ["pickup_date_invalid", "pickup_window_invalid"]);
  assert.deepEqual(whenProblems({ ...collect, pickupDate: "2026-11-06", pickupWindow: "06:00-08:00" }, DALA, NOW), ["pickup_window_invalid"]);
  assert.deepEqual(whenProblems({ ...collect, pickupDate: "2026-11-06", pickupWindow: "19:00-21:00" }, DALA, NOW), []);
});

test("another answer clears what depended on it", () => {
  const chosen = { ...filled(), handoff: "bring_in" as const, businessId: "dala", plannedDate: "2026-11-06", plannedWindow: "14:00-16:00", locationId: "bronx" };
  // Switching to a pickup clears the drop-off answers, and the business whose price depended on it.
  const collect = chooseHandoff(chosen, "collect");
  assert.equal(collect.plannedDate, "");
  assert.equal(collect.plannedWindow, "");
  assert.equal(collect.locationId, "");
  assert.equal(collect.businessId, "");
  const back = chooseHandoff({ ...collect, pickupAddress: "12 Grand Concourse", pickupDate: "2026-11-06", pickupWindow: "09:00-11:00" }, "bring_in");
  assert.equal(back.pickupAddress, "");
  assert.equal(back.pickupDate, "");
  assert.equal(back.pickupWindow, "");
  // On a business's own link the business stays.
  assert.equal(chooseHandoff(chosen, "collect", "dala").businessId, "dala");
  // Choosing again is a no-op (the address is not thrown away).
  const same = { ...collect, pickupAddress: "12 Grand Concourse" };
  assert.equal(chooseHandoff(same, "collect"), same);
  // Another country or mode starts the basket over but keeps the sender and receiver.
  const other = chooseCountry(chosen, "senegal");
  assert.deepEqual(other.lines, []);
  assert.equal(other.handoff, "");
  assert.equal(other.businessId, "");
  assert.equal(other.senderName, " Fatou ");
  assert.equal(other.receiverName, "Mariama");
  assert.equal(chooseMode(chosen, "sea"), chosen);
  assert.equal(chooseMode(chosen, "air").shipMode, "air");
  assert.deepEqual(chooseMode(chosen, "air").lines, []);
});

test("the payload carries the mode, channel, source, window and priced pieces", () => {
  const bring = {
    ...chooseHandoff(filled({ lines: BASKET }), "bring_in"),
    businessId: "dala",
    plannedDate: "2026-11-06",
    plannedWindow: "14:00-16:00",
    pickupNote: "stale",
  };
  const payload = submitPayload(bring, DALA, { lang: "fr", idempotencyKey: "web-key-123456", viaBusiness: false });
  assert.deepEqual(payload, {
    businessId: "dala",
    destinationCountryId: "guinea",
    handoff: "bring_in",
    shipMode: "sea",
    channel: "web",
    foundVia: "laawol",
    locationId: "bronx",
    plannedDate: "2026-11-06",
    plannedWindow: { from: "14:00", to: "16:00" },
    sender: { name: "Fatou", phoneE164: "+16465550100" },
    receiver: { name: "Mariama", phoneE164: "+224620000000" },
    pieces: [
      { priceItemId: "i_phone", quantity: 2, label: "Phone" },
      { categoryId: "clothing", weightLb: 50, weightUnit: "lb", sizePreset: "suitcase" },
      { kind: "barrel" },
      { kind: "box", description: "Generator", photoPaths: ["packageRequestPhotos/dala/u/a.jpg"] },
    ],
    language: "fr",
    idempotencyKey: "web-key-123456",
  });
  // A drop-off sends no pickup.
  assert.equal("pickup" in payload, false);
  const collect = {
    ...chooseHandoff(filled({ lines: BASKET.slice(0, 1), shipMode: "air" }), "collect"),
    pickupAddress: " 12 Grand Concourse ",
    pickupDate: "2026-11-06",
    pickupWindow: "09:00-11:00",
    pickupNote: " Ring twice ",
  };
  const pickup = submitPayload(collect, DALA, { lang: "en", idempotencyKey: "web-key-123456", viaBusiness: true });
  assert.deepEqual((pickup as { pickup?: unknown }).pickup, { address: "12 Grand Concourse", date: "2026-11-06", window: "09:00-11:00", note: "Ring twice" });
  assert.equal(pickup.foundVia, "business");
  assert.equal(pickup.shipMode, "air");
  // A pickup sends neither a location nor a drop-off day.
  assert.equal("locationId" in pickup, false);
  assert.equal("plannedDate" in pickup, false);
});

test("the sent screen says what was agreed", () => {
  const base = { handoff: "bring_in" as const, businessName: "Dala Shipping", when: "Fri, Nov 6, 2–4 PM", place: "410 E 138th St", totalCents: 53000, weighs: true };
  const confirmed = sentView({ ...base, status: "confirmed" }, "en");
  assert.equal(confirmed.title, "You’re all set — bring it Fri, Nov 6, 2–4 PM to 410 E 138th St");
  assert.equal(confirmed.totalLine, "Total: about $530.00");
  assert.equal(confirmed.payNote, "Pay when you drop it off; the final price is set at the counter (weighed items).");
  const plain = sentView({ ...base, status: "confirmed", weighs: false }, "en");
  assert.equal(plain.totalLine, "Total: $530.00");
  assert.equal(plain.payNote, "Pay when you drop it off.");
  const pickup = sentView({ ...base, status: "confirmed", handoff: "collect", place: "12 Grand Concourse" }, "en");
  assert.equal(pickup.title, "You’re all set — Dala Shipping will pick it up Fri, Nov 6, 2–4 PM at 12 Grand Concourse");
  assert.equal(pickup.payNote, "Pay when it is picked up; the final price is set at the counter (weighed items).");
  const waiting = sentView({ ...base, status: "new", totalCents: null }, "en");
  assert.equal(waiting.title, "Dala Shipping will send the price for the items to quote on WhatsApp");
  assert.equal(waiting.totalLine, "");
  assert.equal(waiting.plan, "You bring it Fri, Nov 6, 2–4 PM to 410 E 138th St.");
  assert.equal(sentView({ ...base, status: "confirmed", when: "ven. 6 nov., 14 h–16 h" }, "fr").title, "Tout est prêt — apportez-le ven. 6 nov., 14 h–16 h à 410 E 138th St");
});

test("the request page explains each price and offers a new time only while a drop-off is open", () => {
  assert.equal(priceExplanation({ source: "item", label: "Phone", quantity: 2, unitCents: 4000, includedLb: 2, perLbCents: null, weightLb: null }, "en"), "2 × $40.00 · up to 2 lb each, extra weight is charged at the counter");
  assert.equal(priceExplanation({ source: "item", label: "TV", quantity: 1, unitCents: 12000, includedLb: 0, perLbCents: null, weightLb: null }, "en"), "$120.00");
  assert.equal(priceExplanation({ source: "per_lb", label: "Clothes", quantity: 1, unitCents: null, includedLb: 0, perLbCents: 600, weightLb: 50 }, "en"), "$6.00 per lb × 50 lb, weighed at drop-off");
  assert.equal(priceExplanation({ source: "per_lb", label: "Clothes", quantity: 1, unitCents: null, includedLb: 0, perLbCents: 600, weightLb: 50 }, "fr"), "6,00 $ la lb × 50 lb, pesé au dépôt");
  assert.equal(priceExplanation({ source: "barrel", label: "Barrel", quantity: 1, unitCents: 15000, includedLb: 0, perLbCents: null, weightLb: null }, "en"), "Barrel price");
  assert.equal(priceExplanation(null, "en"), "");
  assert.equal(listPriceCents({ source: "item", label: "Phone", quantity: 2, unitCents: 4000, includedLb: 2, perLbCents: null, weightLb: null }), 8000);
  assert.equal(listPriceCents({ source: "per_lb", label: "Clothes", quantity: 1, unitCents: null, includedLb: 0, perLbCents: 600, weightLb: 50 }), 30000);
  assert.equal(listPriceCents(null), null);

  const location = { id: "bronx", label: "Bronx", address: "410 E 138th St", hours: WEEK };
  assert.equal(canReschedule({ status: "confirmed", handoff: "bring_in", location }), true);
  assert.equal(canReschedule({ status: "new", handoff: "bring_in", location }), true);
  assert.equal(canReschedule({ status: "received", handoff: "bring_in", location }), false);
  assert.equal(canReschedule({ status: "cancelled", handoff: "bring_in", location }), false);
  assert.equal(canReschedule({ status: "confirmed", handoff: "collect", location: null }), false);
  assert.equal(canReschedule({ status: "confirmed", handoff: "bring_in", location: { ...location, hours: null as unknown as WeekHours } }), false);
  assert.deepEqual(reschedulePayload("tok", "2026-11-06", "14:00-16:00"), {
    token: "tok", action: "reschedule", plannedDate: "2026-11-06", plannedWindow: { from: "14:00", to: "16:00" },
  });
  assert.equal(requestPlanText({ handoff: "bring_in", plannedDate: "2026-11-06", plannedWindow: { from: "14:00", to: "16:00" }, pickup: null }, "en"), "Fri, Nov 6, 2–4 PM");
  assert.equal(requestPlanText({ handoff: "bring_in", plannedDate: "2026-11-06", plannedWindow: null, pickup: null }, "en"), "Fri, Nov 6");
  assert.equal(requestPlanText({ handoff: "collect", plannedDate: "", plannedWindow: null, pickup: { address: "x", date: "2026-11-06", window: "morning", note: "", feeCents: null } }, "en"), "Fri, Nov 6, Morning");
  assert.equal(requestPlanText({ handoff: "collect", plannedDate: "", plannedWindow: null, pickup: { address: "x", date: "2026-11-06", window: "14:00-16:00", note: "", feeCents: 2500 } }, "en"), "Fri, Nov 6, 2–4 PM");
});

test("every new refusal reads as a sentence, in both languages", () => {
  for (const code of ["ship_mode_invalid", "air_unavailable", "window_invalid", "quantity_invalid", "weight_invalid", "category_invalid", "channel_invalid", "pickup_out_of_area", "pickup_out_of_range", "pickup_origin_missing"]) {
    const message = REQUEST_ERROR_MESSAGES[code];
    assert.ok(message, code);
    assert.notEqual(translateValue(message, "fr"), message, code);
  }
});

test("the customer form is wired to the price list flow, not the old estimate-first one", () => {
  const form = readFileSync("src/components/package-request-form.tsx", "utf8");
  // No card is asked in this flow; the old card path stays an explicit, optional link.
  assert.doesNotMatch(form, /stripe|startCheckout/i);
  assert.match(form, /submitPackageRequest/);
  assert.match(form, /listPackageRequestOptions/);
  assert.match(form, /pickupQuotePayloads/);
  assert.match(form, /compareRows/);
  assert.match(form, /submitPayload/);
  // The old copy that said the business sends an estimate for everything is gone.
  assert.doesNotMatch(form, /The business sends you an estimate on WhatsApp before you hand anything over/);
  assert.doesNotMatch(form, /Your estimate is on its way/);
  const page = readFileSync("src/components/package-estimate-page.tsx", "utf8");
  assert.match(page, /Pick a new time/);
  assert.match(page, /reschedulePayload/);
  assert.match(page, /request_closed/);
});

test("every sentence the new flow builds from data has its French", () => {
  // The words built in lib (not in JSX) are bilingual here; check a few shapes differ between languages.
  assert.notEqual(totalText({ allPriced: true, totalCents: 100, pricedCents: 100, piecesToQuote: 0, pickupToQuote: false, weighsAtCounter: true }, "en"), totalText({ allPriced: true, totalCents: 100, pricedCents: 100, piecesToQuote: 0, pickupToQuote: false, weighsAtCounter: true }, "fr"));
  assert.notEqual(departureText({ dateKey: "2026-11-07", source: "planned", approximate: false }, "sea", "en"), departureText({ dateKey: "2026-11-07", source: "planned", approximate: false }, "sea", "fr"));
});

// Kilos (docs/SHIPPING_SIMPLE_HOME.md K2/K4).
const KILO_SHOP = option({
  businessId: "kilo",
  businessName: "Kilo Express",
  routes: {
    sea: { items: [PHONE_A], perLbCents: { clothing: 700, general: 2500 }, unit: "kg" },
    air: null,
  },
});

test("kilos: the unit follows a business's own link, pounds when comparing", () => {
  assert.equal(catalogWeightUnit([KILO_SHOP], "kilo"), "kg");
  assert.equal(catalogWeightUnit([KILO_SHOP, DALA], ""), "lb");
  assert.equal(catalogWeightUnit([DALA], "dala"), "lb");
  assert.equal(catalogWeightUnit([], "kilo"), "lb");
});

test("kilos: included weights are shown in the catalog's unit", () => {
  const kilos = buildCatalog([KILO_SHOP], "sea", "kg");
  assert.equal(kilos.items[0].maxIncludedLb, 2);
  assert.equal(includedLbText(kilos.items[0], "en", "kg"), "up to 2 kg each");
  assert.equal(includedLbText(kilos.items[0], "fr", "kg"), "jusqu’à 2 kg chacun");
  // Compared in pounds, the kilo shop's 2 kg is 4.4 lb beside Dala's 2 lb.
  const lbs = buildCatalog([KILO_SHOP, DALA], "sea", "lb");
  const phone = lbs.items.find((i) => i.key === "electronics|phone");
  assert.deepEqual([phone?.minIncludedLb, phone?.maxIncludedLb], [2, 4.4]);
  assert.equal(includedLbText(phone as never, "en"), "up to 2–4.4 lb each");
  assert.equal(includedLbText(phone as never, "fr"), "jusqu’à 2–4,4 lb chacun");
});

test("kilos: a weight line carries its unit, presets and the lb/kg switch", () => {
  const lines = addWeightLine([], "clothing", "kg");
  const line = lines[0] as Extract<BasketLine, { type: "weight" }>;
  assert.equal(line.weightUnit, "kg");
  assert.deepEqual(itemsProblems(lines), ["weight_kg_invalid"]);
  const suitcase = applySizePreset(line, "suitcase");
  assert.equal(suitcase.weightLb, "23");
  assert.equal(typeWeight(suitcase, "23").sizePreset, "suitcase");
  assert.equal(typeWeight(suitcase, "50").sizePreset, "");
  // The limits are 900 kg and 2,000 lb.
  assert.equal(readWeight("900", "kg"), 900);
  assert.equal(readWeight("901", "kg"), null);
  assert.equal(readWeight("901", "lb"), 901);
  assert.equal(readWeight("10,5", "kg"), 10.5);
  // Switching to pounds keeps the size button's meaning; a typed number is converted.
  assert.equal(setWeightUnit(suitcase, "lb").weightLb, "50");
  assert.equal(setWeightUnit(suitcase, "lb").sizePreset, "suitcase");
  const typed = typeWeight(line, "10");
  assert.equal(setWeightUnit(typed, "lb").weightLb, "22");
  assert.equal(setWeightUnit(typeWeight(line, "abc"), "lb").weightLb, "abc");
  assert.equal(setWeightUnit(typed, "kg"), typed);
});

test("kilos: each business prices the number in its own unit, and the unit is sent", () => {
  const inPounds: BasketLine[] = [{ key: "w", type: "weight", categoryId: "clothing", weightLb: "50", weightUnit: "lb", sizePreset: "" }];
  // 50 lb = 22.7 kg x $7 at the kilo shop; 50 lb x $6 at Dala.
  assert.equal(basketFor(KILO_SHOP, inPounds, "sea").totalCents, 15890);
  assert.equal(basketFor(DALA, inPounds, "sea").totalCents, 30000);
  const inKilos: BasketLine[] = [{ key: "w", type: "weight", categoryId: "clothing", weightLb: "10", weightUnit: "kg", sizePreset: "" }];
  assert.equal(basketFor(KILO_SHOP, inKilos, "sea").totalCents, 7000);
  // 10 kg is 22 lb at Dala's $6 a pound.
  assert.equal(basketFor(DALA, inKilos, "sea").totalCents, 13200);
  assert.deepEqual(piecesFor(inKilos, KILO_SHOP, "sea"), [{ categoryId: "clothing", weightLb: 10, weightUnit: "kg" }]);
  assert.deepEqual(piecesFor(inPounds, KILO_SHOP, "sea"), [{ categoryId: "clothing", weightLb: 50, weightUnit: "lb" }]);
});

test("kilos: how a price is explained", () => {
  const kilo = { source: "per_lb" as const, label: "Clothes", quantity: 1, unitCents: null, includedLb: 0, perLbCents: 700, weightLb: 10, unit: "kg" as const };
  assert.equal(priceExplanation(kilo, "en"), "$7.00 per kg × 10 kg, weighed at drop-off");
  assert.equal(priceExplanation(kilo, "fr"), "7,00 $ le kg × 10 kg, pesé au dépôt");
  assert.equal(priceExplanation({ ...kilo, weightLb: 4.5 }, "fr"), "7,00 $ le kg × 4,5 kg, pesé au dépôt");
  const item = { source: "item" as const, label: "Phone", quantity: 2, unitCents: 4000, includedLb: 2, perLbCents: null, weightLb: null, unit: "kg" as const };
  assert.equal(priceExplanation(item, "en"), "2 × $40.00 · up to 2 kg each, extra weight is charged at the counter");
  assert.equal(priceExplanation(item, "fr"), "2 × 40,00 $ · jusqu’à 2 kg chacun, le surplus est facturé au comptoir");
  assert.equal(listPriceCents(kilo), 7000);
});

test("kilos: the error codes have messages and a step", () => {
  assert.ok(REQUEST_ERROR_MESSAGES.weight_kg_invalid);
  assert.ok(REQUEST_ERROR_MESSAGES.unit_invalid);
  assert.match(REQUEST_ERROR_MESSAGES.weight_kg_invalid, /kilos/);
});
