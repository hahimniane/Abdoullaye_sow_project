import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { customerServiceFromLocation } from "./customer-service-intent.ts";
import { serviceEntryApplies } from "./console-routing.ts";
import { translateValue } from "./french-dom.ts";
import { businessTargetForNotification } from "./notification-routing.ts";
import {
  REQUEST_ERROR_MESSAGES,
  REQUEST_STATUS_LABELS,
  HISTORY_ACTION_LABELS,
  chooseHandoff,
  dayIsOpen,
  detailsProblems,
  draftEstimate,
  draftTotalCents,
  e164,
  emptyRequestDraft,
  emptyWeek,
  estimateDraftPrices,
  estimatePageState,
  estimateRows,
  estimateTokenFromLocation,
  expectedRequests,
  filterRequests,
  hoursLines,
  lockView,
  moneyText,
  newPieceDraft,
  piecesProblems,
  piecesSummary,
  plannedDayText,
  readDollars,
  receivePiecesPayload,
  newReceiveItem,
  receiveItemsFrom,
  receiveItemsPayload,
  receivedFlash,
  requestCountries,
  requestFailure,
  requestFilterCounts,
  requestHistory,
  requestLocationsFor,
  requestPathRedirect,
  requestSettingsDraft,
  requestSettingsPayload,
  requestSettingsProblems,
  requestSlugFromLocation,
  sendEstimatePayload,
  slugEditable,
  submitRequestPayload,
  todayKeyIn,
  compressedSize,
  type RequestOption,
  type WeekHours,
} from "./package-requests.ts";

const WEEK: WeekHours = {
  mon: { open: true, from: "09:00", to: "18:00" },
  tue: { open: true, from: "09:00", to: "18:00" },
  wed: { open: true, from: "09:00", to: "18:00" },
  thu: { open: true, from: "09:00", to: "18:00" },
  fri: { open: true, from: "09:00", to: "18:00" },
  sat: { open: true, from: "10:00", to: "14:00" },
  sun: { open: false, from: "09:00", to: "18:00" },
};

const OPTION: RequestOption = {
  businessId: "dala",
  businessName: "Dala Shipping",
  businessPhone: "+16465550199",
  profileImageUrl: "",
  slug: "dala-shipping",
  country: { id: "guinea", name: "Guinea" },
  barrelPriceCents: 15000,
  cardBarrelBooking: false,
  bringIn: { available: true, locations: [{ id: "bronx", label: "Bronx", address: "410 E 138th St", hours: WEEK }] },
  collect: { available: true, areas: "Bronx" },
  timeZone: "America/New_York",
};

// Tuesday, Oct 20 2026, 3 PM in New York.
const NOW = Date.UTC(2026, 9, 20, 19, 0, 0);

test("request and estimate links open the right page", () => {
  assert.equal(customerServiceFromLocation("/r/dala-shipping", ""), "package-request");
  assert.equal(customerServiceFromLocation("/r/dala-shipping/", ""), "package-request");
  assert.equal(customerServiceFromLocation(`/e/${"a".repeat(43)}`, ""), "package-estimate");
  assert.equal(customerServiceFromLocation("/e/short", ""), null);
  assert.equal(customerServiceFromLocation("/", "?service=package-request&r=dala"), "package-request");
  assert.equal(requestSlugFromLocation("/r/Dala-Shipping", ""), "dala-shipping");
  assert.equal(requestSlugFromLocation("/", "?service=package-request&r=dala-ny"), "dala-ny");
  assert.equal(requestSlugFromLocation("/", ""), "");
  assert.equal(estimateTokenFromLocation(`/e/${"b".repeat(43)}`, ""), "b".repeat(43));
  assert.equal(estimateTokenFromLocation("/", `?t=${"c".repeat(43)}`), "c".repeat(43));
  assert.equal(requestPathRedirect("/r/Dala-Shipping/"), "/?service=package-request&r=dala-shipping");
  assert.equal(requestPathRedirect(`/e/${"d".repeat(43)}`), `/?service=package-estimate&t=${"d".repeat(43)}`);
  assert.equal(requestPathRedirect("/nothing"), "");
  // The estimate page is the customer's link: everyone with a console gets it too.
  for (const kind of [null, "customer", "business", "admin"] as const) {
    assert.equal(serviceEntryApplies("package-estimate", kind), true);
  }
  assert.equal(serviceEntryApplies("package-request", "business"), false);
  assert.equal(serviceEntryApplies("package-request", null), true);
});

test("a request notification opens Containers on the Requests list", () => {
  assert.deepEqual(
    businessTargetForNotification({ type: "package_request", requestId: "r1", relatedId: "r1" }),
    { tab: "containers", focusId: "r1", panelView: "requests" },
  );
});

test("dates are the business's and read month first in English", () => {
  assert.equal(todayKeyIn("America/New_York", Date.UTC(2026, 9, 21, 3, 30)), "2026-10-20");
  assert.equal(plannedDayText("2026-10-24", "en"), "Sat, Oct 24");
  assert.equal(plannedDayText("2026-10-24", "fr"), "sam. 24 oct.");
  assert.equal(dayIsOpen(WEEK, "2026-10-25"), false);
  assert.equal(dayIsOpen(WEEK, "2026-10-24"), true);
  assert.deepEqual(hoursLines(WEEK, "en"), ["Mon–Fri 9:00 AM–6:00 PM", "Sat 10:00 AM–2:00 PM"]);
  assert.deepEqual(hoursLines(WEEK, "fr"), ["lun.–ven. 9 h 00–18 h 00", "sam. 10 h 00–14 h 00"]);
  assert.deepEqual(hoursLines(emptyWeek(), "en"), []);
});

test("money and pieces are worded in the page's language", () => {
  assert.equal(moneyText(125000, "en"), "$1,250.00");
  assert.equal(moneyText(125000, "fr"), "1 250,00 $");
  assert.equal(piecesSummary([{ kind: "barrel" }, { kind: "barrel" }, { kind: "box" }], "en"), "2 barrels, 1 box");
  assert.equal(piecesSummary([{ kind: "other" }], "fr"), "1 colis");
  assert.equal(readDollars("45"), 4500);
  assert.equal(readDollars("45,50"), 4550);
  assert.equal(readDollars("1,250.00"), 125000);
  assert.equal(readDollars("12,5,0"), null);
  assert.equal(readDollars("abc"), null);
  assert.equal(readDollars(""), null);
  assert.equal(receivedFlash("CL-K7M4P2", false, "fr"), "Reçu : CL-K7M4P2. Le colis est dans la liste d’attente.");
});

test("phones must be E.164", () => {
  assert.equal(e164("+1 (646) 555-0100"), "+16465550100");
  assert.equal(e164("6465550100"), "");
  assert.equal(e164("+224"), "");
});

test("the form refuses what the server would, before sending", () => {
  const draft = { ...emptyRequestDraft(), businessId: "dala", countryId: "guinea" };
  assert.deepEqual(detailsProblems(draft, OPTION, NOW), [
    "handoff_invalid", "sender_name_required", "sender_phone_invalid",
    "receiver_name_required", "receiver_phone_invalid",
  ]);
  const bring = {
    ...chooseHandoff(draft, "bring_in", OPTION),
    plannedDate: "2026-10-25",
    senderName: "Fatou", senderPhone: "+16465550100",
    receiverName: "Mariama", receiverPhone: "+224620000000",
  };
  // The only location is chosen for them; Sunday is closed.
  assert.equal(bring.locationId, "bronx");
  assert.deepEqual(detailsProblems(bring, OPTION, NOW), ["planned_day_closed"]);
  assert.deepEqual(detailsProblems({ ...bring, plannedDate: "2026-10-19" }, OPTION, NOW), ["planned_date_invalid"]);
  assert.deepEqual(detailsProblems({ ...bring, plannedDate: "2026-10-24" }, OPTION, NOW), []);
  // Switching to "Collect from me" clears the drop-off answers, and back.
  const collect = chooseHandoff({ ...bring, plannedDate: "2026-10-24" }, "collect", OPTION);
  assert.equal(collect.plannedDate, "");
  assert.equal(collect.locationId, "");
  assert.deepEqual(detailsProblems(collect, OPTION, NOW), ["pickup_address_required", "pickup_date_invalid", "pickup_window_invalid"]);
  const back = chooseHandoff({ ...collect, pickupAddress: "12 Grand Concourse", pickupWindow: "evening" }, "bring_in", OPTION);
  assert.equal(back.pickupAddress, "");
  assert.equal(back.pickupWindow, "");
});

test("pieces: a description for boxes and items, at most 20, photos uploaded", () => {
  assert.deepEqual(piecesProblems({ pieces: [] }), ["pieces_required"]);
  assert.deepEqual(piecesProblems({ pieces: [newPieceDraft("box")] }), ["piece_description_required"]);
  assert.deepEqual(piecesProblems({ pieces: Array.from({ length: 21 }, () => newPieceDraft("barrel")) }), ["too_many_pieces"]);
  const withBadPhoto = { ...newPieceDraft("box"), description: "TV", photos: [{ key: "k", path: "", previewUrl: "", status: "error" as const }] };
  assert.deepEqual(piecesProblems({ pieces: [withBadPhoto] }), ["photo_invalid"]);
});

test("the estimate shown before sending prices barrels only", () => {
  const pieces = [newPieceDraft("barrel"), newPieceDraft("barrel"), { ...newPieceDraft("box"), description: "TV" }];
  assert.deepEqual(draftEstimate({ pieces }, OPTION), { pricedCents: 30000, unpriced: 1, allPriced: false });
  assert.deepEqual(draftEstimate({ pieces: pieces.slice(0, 2) }, OPTION), { pricedCents: 30000, unpriced: 0, allPriced: true });
  // No barrel price for the destination: the barrel needs an estimate too.
  assert.deepEqual(draftEstimate({ pieces: pieces.slice(0, 1) }, { ...OPTION, barrelPriceCents: null }), { pricedCents: 0, unpriced: 1, allPriced: false });
});

test("the payload carries only the chosen handoff's answers and ready photos", () => {
  const draft = {
    ...chooseHandoff({ ...emptyRequestDraft(), businessId: "dala", countryId: "guinea" }, "bring_in", OPTION),
    plannedDate: "2026-10-24",
    senderName: " Fatou ", senderPhone: "+1 646 555 0100",
    receiverName: "Mariama", receiverPhone: "+224620000000",
    pieces: [{ ...newPieceDraft("box"), description: "TV", photos: [
      { key: "a", path: "packageRequestPhotos/dala/u/a.jpg", previewUrl: "", status: "ready" as const },
      { key: "b", path: "", previewUrl: "", status: "uploading" as const },
    ] }],
  };
  const payload = submitRequestPayload(draft, OPTION, "fr", "web-key-123456");
  assert.deepEqual(payload, {
    businessId: "dala",
    destinationCountryId: "guinea",
    handoff: "bring_in",
    locationId: "bronx",
    plannedDate: "2026-10-24",
    sender: { name: "Fatou", phoneE164: "+16465550100" },
    receiver: { name: "Mariama", phoneE164: "+224620000000" },
    pieces: [{ kind: "box", description: "TV", photoPaths: ["packageRequestPhotos/dala/u/a.jpg"] }],
    language: "fr",
    idempotencyKey: "web-key-123456",
  });
  assert.equal("pickup" in payload, false);
});

test("countries list once each, in the page's language", () => {
  const options = [OPTION, { ...OPTION, businessId: "b2", businessName: "B2" }, { ...OPTION, country: { id: "senegal", name: "Senegal" } }];
  assert.deepEqual(requestCountries(options, "en").map((c) => c.id), ["guinea", "senegal"]);
});

test("photos are drawn at most 1600 px on the long side, never enlarged", () => {
  assert.deepEqual(compressedSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(compressedSize(800, 600), { width: 800, height: 600 });
});

test("a refusal reads its reason and every reason", () => {
  const failure = requestFailure({ code: "functions/invalid-argument", details: { reason: "sender_phone_invalid", reasons: ["sender_phone_invalid", "receiver_phone_invalid"] } });
  assert.deepEqual(failure.reasons, ["sender_phone_invalid", "receiver_phone_invalid"]);
  assert.equal(failure.message, REQUEST_ERROR_MESSAGES.sender_phone_invalid);
  assert.equal(requestFailure({ code: "functions/resource-exhausted" }).message, REQUEST_ERROR_MESSAGES.rate_limited);
});

const row = (extra: Record<string, unknown> = {}) => ({
  id: "req1",
  status: "new",
  handoff: "bring_in",
  pieces: [
    { id: "p1", kind: "barrel", description: "", estimateCents: 15000, photoPaths: [] },
    { id: "p2", kind: "box", description: "TV", estimateCents: null, photoPaths: ["x"] },
  ],
  ...extra,
});

test("the console's lists: chips, Expected, and the lock", () => {
  const rows = [row(), row({ id: "r2", status: "estimate_sent" }), row({ id: "r3", status: "confirmed", plannedDate: "2026-10-30" }),
    row({ id: "r4", status: "confirmed", plannedDate: "2026-10-22" })];
  assert.deepEqual(requestFilterCounts(rows), { needs_estimate: 1, waiting_customer: 1 });
  assert.deepEqual(filterRequests(rows, "waiting_customer").map((r) => r.id), ["r2"]);
  assert.deepEqual(expectedRequests(rows).map((r) => r.id), ["r4", "r3"]);
  const locked = row({ lock: { uid: "mariama", name: "Mariama", untilMs: NOW + 60_000 } });
  assert.deepEqual(lockView(locked, "awa", NOW), { lockedByOther: true, mine: false, name: "Mariama" });
  assert.equal(lockView(locked, "mariama", NOW).mine, true);
  assert.equal(lockView(locked, "awa", NOW + 120_000).lockedByOther, false);
  assert.equal(REQUEST_STATUS_LABELS.new, "Needs estimate");
});

test("the estimate editor prefills the barrel price and checks every price", () => {
  const r = row();
  assert.deepEqual(estimateDraftPrices(r, "en"), { p1: "150.00", p2: "" });
  assert.deepEqual(estimateDraftPrices(r, "fr"), { p1: "150,00", p2: "" });
  assert.equal(sendEstimatePayload("dala", r, { p1: "150", p2: "" }, { pickupFee: "", note: "" }).error, "estimate_piece_missing");
  assert.equal(sendEstimatePayload("dala", r, { p1: "150", p2: "x" }, { pickupFee: "", note: "" }).error, "amount_invalid");
  assert.deepEqual(sendEstimatePayload("dala", r, { p1: "150", p2: "45,50" }, { pickupFee: "", note: "Heavy" }).payload, {
    businessId: "dala", requestId: "req1", baseVersion: 0,
    pieces: [{ id: "p1", cents: 15000 }, { id: "p2", cents: 4550 }], note: "Heavy",
  });
  const sent = row({ estimate: { version: 2, totalCents: 20000, pieces: [{ id: "p1", cents: 15000 }, { id: "p2", cents: 5000 }] } });
  assert.equal(sendEstimatePayload("dala", sent, { p1: "150", p2: "50" }, { pickupFee: "", note: "" }).payload?.baseVersion, 2);
  assert.deepEqual(estimateDraftPrices(sent, "en"), { p1: "150.00", p2: "50.00" });
  const collect = row({ handoff: "collect" });
  assert.equal(draftTotalCents(collect, { p1: "150", p2: "50" }, "25"), 22500);
  assert.equal(draftTotalCents(collect, { p1: "150", p2: "" }, "25"), null);
});

test("Received sends final prices: all or none", () => {
  const r = row();
  assert.deepEqual(receivePiecesPayload(r, { p1: "150", p2: "40" }), { pieces: [{ id: "p1", priceCents: 15000 }, { id: "p2", priceCents: 4000 }], error: "" });
  assert.equal(receivePiecesPayload(r, { p1: "150", p2: "" }).error, "price_required");
  assert.deepEqual(receivePiecesPayload(r, { p1: "", p2: "" }).pieces.map((p) => p.priceCents), [null, null]);
});

test("Received can add a piece the customer brought and drop one that did not come", () => {
  const items = receiveItemsFrom(row(), "en");
  assert.deepEqual(items.map((i) => [i.id, i.price]), [["p1", "150.00"], ["p2", ""]]);
  const extra = { ...newReceiveItem(), kind: "box" as const, description: "Shoes", price: "30" };
  const payload = receiveItemsPayload([{ ...items[0] }, extra]);
  assert.deepEqual(payload, { error: "", pieces: [{ id: "p1", priceCents: 15000 }, { kind: "box", description: "Shoes", priceCents: 3000 }] });
  assert.equal(receiveItemsPayload([]).error, "pieces_required");
  assert.equal(receiveItemsPayload([{ ...newReceiveItem(), price: "1" }]).error, "piece_description_required");
  assert.equal(receiveItemsPayload(items).error, "price_required");
  const history = requestHistory(row({ history: [{ atMs: 1, action: "pieces_changed", byName: "Awa", piecesAdded: 1, piecesRemoved: 2 }] }));
  assert.equal(history[0].label, "Pieces changed at Received");
  assert.equal(history[0].change, "+1 / −2");
});

test("History reads structured rows, newest first", () => {
  const history = requestHistory(row({ history: [
    { atMs: 1, action: "submitted", byName: "Fatou" },
    { atMs: 2, action: "estimate_sent", byName: "Mariama", version: 1, totalCents: 19500 },
    { atMs: 3, action: "confirmed_phone", byName: "Awa", version: 1 },
  ] }));
  assert.deepEqual(history.map((h) => [h.label, h.byName]), [
    ["Customer agreed by phone", "Awa"], ["Estimate sent", "Mariama"], ["Request sent by the customer", "Fatou"],
  ]);
  assert.equal(history[1].totalCents, 19500);
});

test("the estimate page shows every state", () => {
  const base = { priceDropped: false, estimate: { version: 1, totalCents: 1, pieces: [], pickupFeeCents: 0, pickupSchedule: null, note: "", sentAt: "" } };
  assert.equal(estimatePageState({ ...base, status: "estimate_sent" }), "confirm");
  assert.equal(estimatePageState({ ...base, status: "new", estimate: null }), "waiting_estimate");
  assert.equal(estimatePageState({ ...base, status: "confirmed" }), "confirmed");
  assert.equal(estimatePageState({ ...base, status: "confirmed", priceDropped: true }), "price_dropped");
  for (const status of ["received", "declined", "customer_declined", "cancelled", "expired"] as const) {
    assert.equal(estimatePageState({ ...base, status }), status);
  }
  assert.deepEqual(estimateRows({
    pieces: [{ id: "p1", kind: "barrel", description: "", sizeIn: null, photoCount: 0 }, { id: "p2", kind: "box", description: "TV", sizeIn: null, photoCount: 1 }],
    estimate: { ...base.estimate, pieces: [{ id: "p1", cents: 15000 }] },
  }).map((r) => r.cents), [15000, null]);
});

test("request settings: hours per location, slug once, areas when picking up", () => {
  const business = {
    name: "Dala", addressLine1: "410 East 138th Street", city: "Bronx", state: "NY",
    requestSlug: "dala", requestSlugEdits: 0,
    packageRequestSettings: { acceptRequests: true, openingHours: { default: WEEK }, pickup: { enabled: true, areas: "Bronx" }, cardBarrelBooking: true },
  };
  // No office locations: the headquarters is "default", as on the server.
  const locations = requestLocationsFor([], business);
  assert.deepEqual(locations.map((l) => l.id), ["default"]);
  assert.deepEqual(requestLocationsFor([{ id: "a", label: "A", address: "x", isActive: true }, { id: "b", isActive: false }], business).map((l) => l.id), ["a"]);
  const draft = requestSettingsDraft(business, locations);
  assert.equal(draft.hours.default.sat.from, "10:00");
  assert.equal(draft.cardBarrelBooking, true);
  assert.deepEqual(requestSettingsProblems({ ...draft, pickupAreas: " " }), ["pickup_areas_required"]);
  assert.deepEqual(requestSettingsProblems({ ...draft, slug: "Bad Slug" }), ["slug_invalid"]);
  const badHours = { ...draft, hours: { default: { ...WEEK, mon: { open: true, from: "18:00", to: "09:00" } } } };
  assert.deepEqual(requestSettingsProblems(badHours), ["hours_invalid"]);
  const payload = requestSettingsPayload("dala", { ...draft, slug: "dala" }, "dala");
  assert.equal("requestSlug" in payload, false, "an unchanged slug is not sent");
  assert.equal(requestSettingsPayload("dala", { ...draft, slug: "dala-ny" }, "dala").requestSlug, "dala-ny");
  assert.equal(slugEditable(business), true);
  assert.equal(slugEditable({ ...business, requestSlugEdits: 1 }), false);
  assert.equal(slugEditable({}), true);
});

// Every English string the request screens render must have a French entry
// (guardrails §5). Pulled from the source, so a new string fails here.
test("every request screen string has a French translation", () => {
  const files = [
    "src/components/package-request-form.tsx",
    "src/components/package-estimate-page.tsx",
    "src/components/business/package-requests-panel.tsx",
  ];
  const strings = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) {
      const value = match[1].trim().replace(/&apos;/g, "'").replace(/&amp;/g, "&");
      if (value && !value.includes("=") && !value.includes("&&") && !value.startsWith("//") && !value.startsWith(")")) strings.add(value);
    }
    for (const match of source.matchAll(/(?:placeholder|aria-label|title|alt|label)="([^"]*[A-Za-z][^"]*)"/g)) strings.add(match[1]);
    for (const match of source.matchAll(/\? "([A-Z][^"\n]{3,})"\s*:\s*"([A-Z][^"\n]{3,})"/g)) {
      strings.add(match[1]);
      strings.add(match[2]);
    }
  }
  for (const table of [REQUEST_ERROR_MESSAGES, REQUEST_STATUS_LABELS, HISTORY_ACTION_LABELS]) {
    for (const value of Object.values(table)) strings.add(value);
  }
  // Names, codes and units that read the same in both languages.
  const same = new Set(["Total", "Containers", "History", "Pickup", "Estimate", "Expected", "Received", "Box", "Other", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "PM", "UTC", "your-business", "Saving...", "Sending...", "Loading…"]);
  const missing = [...strings].filter((value) => !same.has(value) && translateValue(value, "fr") === value);
  assert.deepEqual(missing, []);
});
