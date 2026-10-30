import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { customerServiceFromLocation } from "./customer-service-intent.ts";
import { serviceEntryApplies } from "./console-routing.ts";
import { translateValue } from "./french-dom.ts";
import { businessTargetForNotification } from "./notification-routing.ts";
import { containerLineTitle } from "./container-manifest.ts";
import { newPieceDraft as newLinePieceDraft } from "./piece-drafts.ts";
import { labelsPieceCount } from "./waiting-packages.ts";
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
  pieceSummaryText,
  pieceKindLabel,
  plannedDayText,
  readDollars,
  receiveDraftsFrom,
  receivedLineStub,
  receivePayload,
  receivePrefillCents,
  receivePrefillPickupFeeCents,
  receiveTakesPickupFee,
  receiveTotalCents,
  receivedFlash,
  requestCountries,
  requestFailure,
  requestFilterCounts,
  requestHistory,
  requestLocationsFor,
  requestPathRedirect,
  requestSettingsDraft,
  normalizeRequestCode,
  lookupRequestCodePayload,
  proofSettingsOf,
  PROOF_SETTING_COPY,
  PROOF_SETTING_KEYS,
  requestSettingsPayload,
  requestSettingsProblems,
  requestSlugFromLocation,
  sendEstimatePayload,
  confirmedBannerText,
  estimateScheduleDraft,
  estimateScheduleProblem,
  pickupWhen,
  requestEstimate,
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
  // A request's pieces read as phase 1 reads a line's (pieceSummaryText).
  assert.equal(pieceSummaryText([{ kind: "barrel" }, { kind: "barrel" }, { kind: "box" }], "en"), "2 barrels, 1 box");
  assert.equal(pieceSummaryText([{ kind: "barrel" }, { kind: "box", description: "Clothes and shoes" }, { kind: "other", description: "Shoes" }], "en"), "1 barrel, 1 box, Shoes");
  assert.equal(pieceSummaryText([{ kind: "other", description: "TV" }, { kind: "other", description: "Fan" }], "fr"), "2 articles");
  assert.equal(pieceKindLabel("barrel", "fr"), "Baril");
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
  assert.deepEqual(requestCountries(options, "fr").map((c) => c.name), ["Guinée", "Sénégal"]);
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

test("a collect request's note and pickup time reach staff (1.0.17 click-through)", () => {
  // The customer's pickup.note was never shown; the estimate's real day and
  // window (pickupSchedule) win over what the customer asked for.
  const asked = row({ handoff: "collect", timeZone: "America/New_York",
    pickup: { address: "12 Grand Concourse", date: "2026-10-22", window: "morning", note: "Ring twice, 3rd floor" } });
  assert.deepEqual(pickupWhen(asked), { date: "2026-10-22", window: "morning", scheduled: false, address: "12 Grand Concourse", note: "Ring twice, 3rd floor" });
  assert.equal(pickupWhen(row()), null);
  const set = { ...asked, estimate: { version: 1, totalCents: 15000, pieces: [], pickupSchedule: { date: "2026-10-24", window: "evening" } } };
  assert.deepEqual(pickupWhen(set), { date: "2026-10-24", window: "evening", scheduled: true, address: "12 Grand Concourse", note: "Ring twice, 3rd floor" });
  assert.deepEqual(requestEstimate(set)?.pickupSchedule, { date: "2026-10-24", window: "evening" });
  assert.equal(requestEstimate({ estimate: { version: 1, pickupSchedule: { date: "nope", window: "noon" } } })?.pickupSchedule, null);
  // The console's editor opens on the last estimate's schedule, else the ask.
  assert.deepEqual(estimateScheduleDraft(asked), { date: "2026-10-22", window: "morning" });
  assert.deepEqual(estimateScheduleDraft(set), { date: "2026-10-24", window: "evening" });
  assert.deepEqual(estimateScheduleDraft(row()), { date: "", window: "" });
  // Every card that shows a pickup shows the note, labelled, as user text.
  const panel = readFileSync("src/components/business/package-requests-panel.tsx", "utf8");
  assert.match(panel, /<span>Note:<\/span> <span data-no-translate>\{when\.note\}<\/span>/);
  assert.match(panel, /<div className="pkq-detail"><PersonLines row=\{row\} \/><WhenLine row=\{row\} \/><\/div>/);
  assert.equal(translateValue("Note:", "fr"), "Note :");
});

test("the console's estimate sends the real pickup day and window, as the app does", () => {
  const collect = row({ handoff: "collect", timeZone: "America/New_York",
    pickup: { address: "12 Grand Concourse", date: "2026-10-22", window: "morning", note: "" } });
  const prices = { p1: "150", p2: "40" };
  const sent = sendEstimatePayload("dala", collect, prices, { pickupFee: "20", note: "", schedule: { date: "2026-10-23", window: "afternoon" }, nowMs: NOW });
  assert.deepEqual(sent.payload?.pickupSchedule, { date: "2026-10-23", window: "afternoon" });
  assert.equal(sent.payload?.pickupFeeCents, 2000);
  // An empty day sends no schedule (the server keeps null).
  assert.equal("pickupSchedule" in (sendEstimatePayload("dala", collect, prices, { pickupFee: "", note: "", schedule: { date: "", window: "" }, nowMs: NOW }).payload ?? {}), false);
  // The server's pickup_schedule_invalid: today .. +60 in the business's zone, with a window.
  assert.equal(estimateScheduleProblem({ date: "2026-10-20", window: "evening" }, "America/New_York", NOW), "");
  assert.equal(estimateScheduleProblem({ date: "2026-10-19", window: "evening" }, "America/New_York", NOW), "pickup_schedule_invalid");
  assert.equal(estimateScheduleProblem({ date: "2026-12-19", window: "morning" }, "America/New_York", NOW), "");
  assert.equal(estimateScheduleProblem({ date: "2026-12-20", window: "morning" }, "America/New_York", NOW), "pickup_schedule_invalid");
  assert.equal(estimateScheduleProblem({ date: "2026-10-23", window: "" }, "America/New_York", NOW), "pickup_schedule_invalid");
  assert.equal(sendEstimatePayload("dala", collect, prices, { pickupFee: "", note: "", schedule: { date: "2026-10-01", window: "morning" }, nowMs: NOW }).error, "pickup_schedule_invalid");
  // A bring-in request never carries one.
  assert.equal("pickupSchedule" in (sendEstimatePayload("dala", row(), prices, { pickupFee: "", note: "", schedule: { date: "2026-10-23", window: "morning" }, nowMs: NOW }).payload ?? {}), false);
  assert.equal(REQUEST_ERROR_MESSAGES.pickup_schedule_invalid, "Choose a valid pickup day and time.");
  const panel = readFileSync("src/components/business/package-requests-panel.tsx", "utf8");
  assert.match(panel, /sendEstimatePayload\(businessId, row, prices, \{ pickupFee, note, schedule \}\)/);
  assert.match(panel, /type="date"/);
});

test("collect wording: the /e/ page and WhatsApp-not-connected (1.0.17 click-through)", () => {
  assert.equal(confirmedBannerText({ handoff: "bring_in", payment: { timing: "" } }), "You confirmed this estimate. The business is expecting you.");
  assert.equal(confirmedBannerText({ handoff: "collect", payment: { timing: "" } }), "You confirmed this estimate. The business will come to collect it.");
  assert.equal(confirmedBannerText({ handoff: "collect", payment: { timing: "card" } }), "Paid online. The business will come to collect it.");
  for (const value of ["You confirmed this estimate. The business will come to collect it.", "Paid online. The business will come to collect it."]) {
    assert.notEqual(translateValue(value, "fr"), value);
  }
  const panel = readFileSync("src/components/business/package-requests-panel.tsx", "utf8");
  const line = panel.slice(panel.indexOf("function WhatsAppLine"), panel.indexOf("function PersonLines"));
  // waiting_for_whatsapp = no WhatsApp connected, not "waiting for approval".
  assert.match(line, /status === "waiting_for_whatsapp"\) \{\s*return <small className="pkq-muted">WhatsApp is not connected yet\./);
});

test("Received sends final prices: all or none", () => {
  const priced = receiveDraftsFrom(row()).map((d, i) => ({ ...d, price: ["150", "40"][i] }));
  assert.deepEqual(receivePayload(priced), { error: "", pieces: [
    { id: "p1", kind: "barrel", description: "", sizeIn: null, priceCents: 15000 },
    { id: "p2", kind: "box", description: "TV", sizeIn: null, priceCents: 4000 }] });
  assert.equal(receiveTotalCents(priced), 19000);
  assert.equal(receivePayload(priced.map((d, i) => (i === 1 ? { ...d, price: "" } : d))).error, "price_required");
  assert.deepEqual(receivePayload(priced.map((d) => ({ ...d, price: "" }))).pieces.map((p) => p.priceCents), [null, null]);
});

test("Received opens in phase 1's pieces editor, the pickup fee beside the prices", () => {
  // The same rule and numbers as functions/request_receive.js
  // (receivePrefillCents / receivePrefillPickupFeeCents) and the app's
  // mirror. Owner decision 2026-10-18: the fee is never spread into pieces.
  const estimate = { version: 1, totalCents: 22001, pieces: [{ id: "p1", cents: 15000 }, { id: "p2", cents: 4500 }], pickupFeeCents: 2501 };
  assert.deepEqual([...receivePrefillCents(row({ estimate }))], [["p1", 15000], ["p2", 4500]]);
  assert.deepEqual([...receivePrefillCents(row({ estimate, handoff: "collect" }))], [["p1", 15000], ["p2", 4500]]);
  assert.deepEqual([...receivePrefillCents(row())], [["p1", 15000], ["p2", null]]);
  assert.equal(receivePrefillPickupFeeCents(row({ estimate, handoff: "collect" })), 2501);
  assert.equal(receivePrefillPickupFeeCents(row({ estimate })), 0);
  assert.equal(receiveTakesPickupFee(row({ estimate })), false);
  assert.equal(receiveTakesPickupFee(row({ estimate, handoff: "collect" })), true);
  const collect = row({ estimate, handoff: "collect", pieces: [
    { id: "p1", kind: "barrel", description: "", estimateCents: 15000 },
    { id: "p2", kind: "box", description: "TV", sizeIn: { l: 30, w: 20, h: 10 }, estimateCents: null }] });
  const drafts = receiveDraftsFrom(collect);
  assert.deepEqual(drafts.map((d) => [d.id, d.kind, d.description, d.lengthIn, d.price]),
    [["p1", "barrel", "", "", "150"], ["p2", "box", "TV", "30", "45"]]);
  assert.equal(receiveTotalCents(drafts), 19500);
  assert.equal(receiveTotalCents(drafts, receivePrefillPickupFeeCents(collect)), 22001);
  // The payload sends the fee as typed, on its own; a bad one is refused.
  const sent = receivePayload(drafts, "25.01");
  assert.equal(sent.error, "");
  assert.equal(sent.pickupFeeCents, 2501);
  assert.deepEqual(sent.pieces.map((p) => p.priceCents), [15000, 4500]);
  assert.equal(receivePayload(drafts, "").pickupFeeCents, 0);
  assert.equal(receivePayload(drafts, "-5").error, "pickup_fee_invalid");
  assert.equal("pickupFeeCents" in receivePayload(drafts), false, "a request brought in sends none");
  // The labels stub carries it as the line will: own field, inside the total.
  const stub = receivedLineStub({ lineId: "l1", trackingCode: "CL-DCZDPT" }, sent.pieces, 2501);
  assert.equal(stub.pickupFeeCents, 2501);
  assert.equal(stub.priceCents, 22001);
  assert.equal(stub.pieceCount, 2);
});

test("Received can add a piece the customer brought and drop one that did not come", () => {
  const drafts = receiveDraftsFrom(row());
  const extra = { ...newLinePieceDraft("box"), description: "Shoes", price: "30" };
  const payload = receivePayload([{ ...drafts[0] }, extra]);
  assert.deepEqual(payload, { error: "", pieces: [
    { id: "p1", kind: "barrel", description: "", sizeIn: null, priceCents: 15000 },
    { id: "", kind: "box", description: "Shoes", sizeIn: null, priceCents: 3000 }] });
  assert.equal(receivePayload([]).error, "pieces_required");
  assert.equal(receivePayload([{ ...newLinePieceDraft("box"), price: "1" }]).error, "piece_description_required");
  assert.equal(receivePayload(drafts).error, "price_required");
  const many = Array.from({ length: 21 }, () => ({ ...newLinePieceDraft("barrel"), price: "1" }));
  assert.equal(receivePayload(many).error, "too_many_pieces");
  // Regression (browser check): the labels dialog after Received was handed
  // a line with no pieces, so it read "Prints 2 labels: 1 piece × 2" for a
  // three-piece load. The stub carries the pieces as they arrived.
  const arrived = receivePayload([{ ...drafts[0] }, { ...drafts[1], price: "45" }, extra]).pieces;
  const stub = receivedLineStub({ lineId: "l1", trackingCode: "CL-DCZDPT" }, arrived);
  assert.equal(stub.pieceCount, 3);
  assert.equal(stub.containerStatus, "waiting");
  assert.equal(labelsPieceCount([stub]), 3);
  assert.equal(containerLineTitle(stub), "1 barrel, 2 boxes");
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

test("proof settings: three switches, off unless stored true, always sent as `proof`", () => {
  const business = { packageProofSettings: { photosRequired: true, senderConfirm: "yes", pickupCode: false } };
  assert.deepEqual(proofSettingsOf(business), { photosRequired: true, senderConfirm: false, pickupCode: false });
  assert.deepEqual(proofSettingsOf({}), { photosRequired: false, senderConfirm: false, pickupCode: false });
  assert.deepEqual(PROOF_SETTING_KEYS, ["photosRequired", "senderConfirm", "pickupCode"]);
  const draft = requestSettingsDraft(business, []);
  assert.deepEqual(draft.proof, { photosRequired: true, senderConfirm: false, pickupCode: false });
  assert.deepEqual(requestSettingsProblems(draft), []);
  assert.deepEqual(requestSettingsProblems({ ...draft, proof: { ...draft.proof, pickupCode: "on" as unknown as boolean } }), ["proof_settings_invalid"]);
  const payload = requestSettingsPayload("dala", { ...draft, proof: { ...draft.proof, pickupCode: true } }, "");
  assert.deepEqual(payload.proof, { photosRequired: true, senderConfirm: false, pickupCode: true });
  // The server's keys, verbatim (package_proof.PROOF_SETTING_KEYS).
  const server = readFileSync("../my_flutter_app/functions/package_proof.js", "utf8");
  assert.match(server, /\["photosRequired", "senderConfirm", "pickupCode"\]/);
  assert.match(readFileSync("../my_flutter_app/functions/index.js", "utf8"), /packageProof\.validateProofSettings\(data\.proof\)/);
  for (const key of PROOF_SETTING_KEYS) {
    assert.ok(PROOF_SETTING_COPY[key].label && PROOF_SETTING_COPY[key].hint, key);
  }
});

test("the counter's request code is normalised as on the server, and looked up by action", () => {
  for (const typed of ["R-K7M4P", "r-k7m4p", "RK7M4P", " k7 m4p ", "K7M4P", "r k7m4p"]) {
    assert.equal(normalizeRequestCode(typed), "R-K7M4P", typed);
  }
  assert.equal(normalizeRequestCode("K7M4"), "");
  // R is a code letter too: a code starting with R typed without its prefix stays itself.
  for (const typed of ["RK7M4", "rk7m4", "R-RK7M4", "rrk7m4"]) {
    assert.equal(normalizeRequestCode(typed), "R-RK7M4", typed);
  }
  assert.equal(normalizeRequestCode("CL-K7M4P2"), "");
  assert.equal(normalizeRequestCode(""), "");
  assert.deepEqual(lookupRequestCodePayload("dala", "k7m4p"), { businessId: "dala", action: "lookup_code", code: "R-K7M4P" });
  const server = readFileSync("../my_flutter_app/functions/package_requests.js", "utf8");
  assert.match(server, /\.toUpperCase\(\)\.replace\(\/\[\\s-\]\+\/g, ""\)/);
  assert.match(server, /typed\.length === 6 && typed\.startsWith\("R"\)/);
  assert.match(server, /\/\^\[A-Z0-9\]\{5\}\$\/\.test\(body\)/);
  assert.match(readFileSync("../my_flutter_app/functions/index.js", "utf8"), /String\(data\.action \|\| ""\) === "lookup_code"/);
  assert.equal(requestFailure({ code: "functions/not-found", details: { reason: "not_found" } }).message, "No request with that code for this business.");
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
  const same = new Set(["Total", "Containers", "History", "Pickup", "Estimate", "Expected", "Received", "Box", "Other", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "PM", "UTC", "your-business", "R-K7M4P", "Reçu", "Saving...", "Sending...", "Loading…"]);
  const missing = [...strings].filter((value) => !same.has(value) && translateValue(value, "fr") === value);
  assert.deepEqual(missing, []);
});
