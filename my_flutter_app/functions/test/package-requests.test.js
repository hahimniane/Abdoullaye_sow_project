"use strict";

// The pure rules of customer package requests (docs/PACKAGE_REQUESTS.md
// §2-§4, §7, §8): settings, eligibility, the submission, estimates and the
// lock, confirming, timers, the words in messages, the customer's view, and
// the line "Received" writes. The callables are exercised against the
// emulator in package-request-callables.test.js.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const pr = require("../package_requests");
const rr = require("../request_receive");
const volume = require("../volume_counts");
const {
  REQUEST_TEMPLATE,
  REQUEST_TEMPLATE_VARIABLES,
  requestTemplateForUpdate,
  requestTemplateMessage,
} = require("../whatsapp_templates");

const NY = "America/New_York";
// Tuesday, October 20, 2026, 3:00 PM in New York (19:00 UTC).
const NOW = Date.UTC(2026, 9, 20, 19, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const WEEK = {
  mon: {open: true, from: "09:00", to: "18:00"},
  tue: {open: true, from: "09:00", to: "18:00"},
  wed: {open: true, from: "09:00", to: "18:00"},
  thu: {open: true, from: "09:00", to: "18:00"},
  fri: {open: true, from: "09:00", to: "18:00"},
  sat: {open: true, from: "10:00", to: "14:00"},
  sun: {open: false},
};

const business = (extra = {}) => ({
  name: "Dala Shipping",
  status: "approved",
  phone: "+16465550199",
  requestSlug: "dala-shipping",
  packageRequestSettings: {
    acceptRequests: true,
    openingHours: {bronx: WEEK},
    pickup: {enabled: true, areas: "Bronx, Harlem"},
    cardBarrelBooking: false,
    timeZone: NY,
  },
  ...extra,
});
const LOCATIONS = [
  {id: "bronx", label: "Bronx office", address: "410 E 138th St, Bronx"},
  {id: "queens", label: "Queens", address: "1 Main St, Queens"},
];
const guinea = (extra = {}) => ({name: "Guinea", isActive: true,
  barrelShippingPrice: 150, ...extra});
const option = (biz = business(), dest = guinea()) => pr.requestOption({
  businessId: "dala", business: biz, destinationId: "gn",
  destination: dest, locations: LOCATIONS});

const submission = (extra = {}) => ({
  businessId: "dala",
  destinationCountryId: "gn",
  handoff: "bring_in",
  locationId: "bronx",
  plannedDate: "2026-10-24",
  sender: {name: "Fatou Diallo", phoneE164: "+16465550100"},
  receiver: {name: "Mariama Bah", phoneE164: "+224620000000"},
  pieces: [{kind: "barrel"}, {kind: "box", description: "Clothes"}],
  language: "en",
  idempotencyKey: "key-12345678",
  ...extra,
});
const validate = (input, opt = option(), biz = business()) =>
  pr.validateSubmission(input, {option: opt, business: biz,
    businessId: "dala", uid: "anon-1", nowMs: NOW});

describe("request link slug", () => {
  it("comes from the business name and stays valid", () => {
    assert.equal(pr.slugFromName("Dala Shipping & Co."), "dala-shipping-co");
    assert.equal(pr.slugFromName("Société Générale d'Expédition"),
        "societe-generale-d-expedition");
    assert.ok(pr.slugValid(pr.slugFromName("A")));
    assert.ok(pr.slugValid(pr.slugFromName("")));
    assert.equal(pr.slugFromName("x".repeat(80)).length, 40);
  });

  it("is [a-z0-9-]{3,40} with no dash at the ends", () => {
    for (const ok of ["abc", "dala-shipping", "a1b", "x".repeat(40)]) {
      assert.ok(pr.slugValid(ok), ok);
    }
    for (const bad of ["ab", "-abc", "abc-", "ABC", "a b", "a--b",
      "x".repeat(41), "", null, 7]) {
      assert.ok(!pr.slugValid(bad), String(bad));
    }
  });

  it("numbers a taken slug within 40 characters", () => {
    assert.equal(pr.slugCandidate("dala", 0), "dala");
    assert.equal(pr.slugCandidate("dala", 2), "dala-2");
    const long = pr.slugCandidate("x".repeat(40), 12);
    assert.equal(long.length, 40);
    assert.ok(long.endsWith("-12") && pr.slugValid(long));
  });
});

describe("business settings", () => {
  it("keeps hours only for the business's own locations", () => {
    const out = pr.validateRequestSettings({
      acceptRequests: true,
      openingHours: {bronx: WEEK, elsewhere: WEEK},
      pickup: {enabled: false, areas: ""},
    }, {locationIds: ["bronx"]});
    assert.deepEqual(out.errors, ["location_unknown"]);
  });

  it("refuses a day that closes before it opens", () => {
    const out = pr.validateRequestSettings({
      openingHours: {bronx: {...WEEK, mon: {open: true, from: "18:00",
        to: "09:00"}}},
    }, {locationIds: ["bronx"]});
    assert.deepEqual(out.errors, ["hours_invalid"]);
  });

  it("needs the pickup areas when pickup is on", () => {
    assert.deepEqual(pr.validateRequestSettings({
      pickup: {enabled: true, areas: "  "}}, {}).errors,
    ["pickup_areas_required"]);
    assert.deepEqual(pr.validateRequestSettings({
      pickup: {enabled: true, areas: "x".repeat(301)}}, {}).errors,
    ["text_too_long"]);
  });

  it("defaults card barrels off and the zone to New York", () => {
    const out = pr.validateRequestSettings({}, {});
    assert.equal(out.settings.cardBarrelBooking, false);
    assert.equal(out.settings.acceptRequests, false);
    assert.equal(out.settings.timeZone, NY);
    assert.equal(pr.businessTimeZone("Not/AZone"), NY);
  });

  it("checks a requested slug", () => {
    assert.deepEqual(pr.validateRequestSettings({requestSlug: "Bad Slug"},
        {}).errors, ["slug_invalid"]);
    assert.equal(pr.validateRequestSettings({requestSlug: "Dala-NY"},
        {}).slug, "dala-ny");
  });
});

describe("which businesses a customer sees (§2, §4)", () => {
  it("offers bring-in only at locations with hours", () => {
    const opt = option();
    assert.equal(opt.bringIn.available, true);
    assert.deepEqual(opt.bringIn.locations.map((l) => l.id), ["bronx"]);
    assert.equal(opt.collect.available, true);
    assert.equal(opt.barrelPriceCents, 15000);
  });

  it("is not listed for bring-in without opening hours", () => {
    const noHours = business({packageRequestSettings: {
      ...business().packageRequestSettings, openingHours: {}}});
    const opt = option(noHours);
    assert.equal(opt.bringIn.available, false);
    assert.equal(opt.collect.available, true);
    const neither = business({packageRequestSettings: {
      ...business().packageRequestSettings, openingHours: {},
      pickup: {enabled: false, areas: ""}}});
    assert.equal(option(neither), null);
  });

  it("is not listed when requests are off, unapproved, or the " +
      "destination is inactive", () => {
    assert.equal(option(business({packageRequestSettings: {
      ...business().packageRequestSettings, acceptRequests: false}})), null);
    assert.equal(option(business({status: "pending"})), null);
    assert.equal(option(business(), guinea({isActive: false})), null);
    assert.equal(option(business({requestSlug: ""})), null);
  });

  it("treats a missing barrel price as needing an estimate", () => {
    assert.equal(option(business(), guinea({barrelShippingPrice: 0}))
        .barrelPriceCents, null);
  });
});

describe("the customer's submission", () => {
  it("accepts a complete bring-in request and prices its barrel", () => {
    const out = validate(submission());
    assert.deepEqual(out.errors, []);
    assert.equal(out.precondition, "");
    assert.equal(out.record.handoff, "bring_in");
    assert.deepEqual(out.record.location, {id: "bronx",
      label: "Bronx office", address: "410 E 138th St, Bronx"});
    assert.deepEqual(out.record.pieces.map((p) => [p.id, p.kind,
      p.estimateCents]), [["p1", "barrel", 15000], ["p2", "box", null]]);
    assert.equal(out.record.pieceCount, 2);
    assert.equal(out.record.barrelPieces, 1);
    assert.equal(out.record.packagePieces, 1);
  });

  it("refuses when the offer is not there (failed-precondition)", () => {
    assert.equal(validate(submission(), option(), null).precondition,
        "business_unavailable");
    const off = business({packageRequestSettings: {
      ...business().packageRequestSettings, acceptRequests: false}});
    assert.equal(validate(submission(), null, off).precondition,
        "requests_off");
    assert.equal(validate(submission(), null).precondition,
        "destination_unavailable");
    const noHours = business({packageRequestSettings: {
      ...business().packageRequestSettings, openingHours: {}}});
    assert.equal(validate(submission(), option(noHours), noHours)
        .precondition, "bring_in_unavailable");
    const noPickup = business({packageRequestSettings: {
      ...business().packageRequestSettings,
      pickup: {enabled: false, areas: ""}}});
    assert.equal(validate(submission({handoff: "collect"}),
        option(noPickup), noPickup).precondition, "collect_unavailable");
  });

  it("validates phones as E.164", () => {
    const out = validate(submission({
      sender: {name: "Fatou", phoneE164: "646 555 0100"},
      receiver: {name: "Mariama", phoneE164: "+224"},
    }));
    assert.deepEqual(out.errors, ["sender_phone_invalid",
      "receiver_phone_invalid"]);
    const formatted = validate(submission({
      sender: {name: "Fatou", phoneE164: "+1 (646) 555-0100"}}));
    assert.equal(formatted.record.sender.phoneE164, "+16465550100");
  });

  it("caps pieces at 20 and needs a description for boxes and items", () => {
    const many = Array.from({length: 21}, () => ({kind: "barrel"}));
    assert.ok(validate(submission({pieces: many})).errors
        .includes("too_many_pieces"));
    assert.deepEqual(validate(submission({pieces: []})).errors,
        ["pieces_required"]);
    assert.deepEqual(validate(submission({pieces: [{kind: "other"}]}))
        .errors, ["piece_description_required"]);
    assert.deepEqual(validate(submission({pieces: [{kind: "car"}]}))
        .errors, ["piece_kind_invalid", "piece_description_required"]);
  });

  it("limits text lengths", () => {
    assert.deepEqual(validate(submission({
      sender: {name: "x".repeat(81), phoneE164: "+16465550100"}})).errors,
    ["text_too_long"]);
    assert.deepEqual(validate(submission({pieces: [{kind: "box",
      description: "x".repeat(121)}]})).errors, ["text_too_long"]);
  });

  it("checks photos belong to the caller, five at most", () => {
    const own = (n) => `packageRequestPhotos/dala/anon-1/photo-${n}-abcdef.jpg`;
    assert.deepEqual(validate(submission({pieces: [{kind: "box",
      description: "TV", photoPaths: [own(1), own(2)]}]})).errors, []);
    assert.deepEqual(validate(submission({pieces: [{kind: "box",
      description: "TV", photoPaths: [1, 2, 3, 4, 5, 6].map(own)}]})).errors,
    ["too_many_photos"]);
    for (const bad of [
      "packageRequestPhotos/other/anon-1/photo-1-abcdef.jpg",
      "packageRequestPhotos/dala/someone-else/photo-1-abcdef.jpg",
      "packageRequestPhotos/dala/anon-1/../x.jpg",
      "cars/dala/x/photo-1-abcdef.jpg",
    ]) {
      assert.deepEqual(validate(submission({pieces: [{kind: "box",
        description: "TV", photoPaths: [bad]}]})).errors, ["photo_invalid"],
      bad);
    }
    assert.deepEqual(validate(submission({pieces: [{kind: "box",
      description: "TV", photoPaths: [own(1), own(1)]}]})).errors,
    ["photo_invalid"]);
    assert.ok(pr.photoMetadataValid({contentType: "image/jpeg", size: 1000}));
    assert.ok(!pr.photoMetadataValid({contentType: "image/gif", size: 1000}));
    assert.ok(!pr.photoMetadataValid({contentType: "image/jpeg",
      size: 2 * 1024 * 1024}));
  });

  it("plans the day in the business's zone, never a closed day", () => {
    // 11:30 PM Oct 20 in New York is already Oct 21 in UTC: "today" is the
    // 20th there, so the 20th may still be chosen.
    const lateNight = Date.UTC(2026, 9, 21, 3, 30);
    const ok = pr.validateSubmission(submission({plannedDate: "2026-10-20"}),
        {option: option(), business: business(), businessId: "dala",
          uid: "anon-1", nowMs: lateNight});
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(validate(submission({plannedDate: "2026-10-19"})).errors,
        ["planned_date_invalid"]);
    assert.deepEqual(validate(submission({plannedDate: "2026-12-25"})).errors,
        ["planned_date_invalid"]);
    // Sunday Oct 25 2026: closed.
    assert.deepEqual(validate(submission({plannedDate: "2026-10-25"})).errors,
        ["planned_day_closed"]);
    assert.deepEqual(validate(submission({plannedDate: "2026-02-30"})).errors,
        ["planned_date_invalid"]);
  });

  it("needs a pickup address, day and window to be collected", () => {
    const out = validate(submission({handoff: "collect",
      pickup: {address: "", date: "nope", window: "night"}}));
    assert.deepEqual(out.errors, ["pickup_address_required",
      "pickup_date_invalid", "pickup_window_invalid"]);
    const ok = validate(submission({handoff: "collect", locationId: "",
      plannedDate: "", pickup: {address: "12 Grand Concourse",
        date: "2026-10-22", window: "evening", note: "Ring twice"}}));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.record.location, null);
    assert.equal(ok.record.plannedDate, "");
    assert.equal(ok.record.pickup.window, "evening");
  });

  it("needs a language and an idempotency key", () => {
    assert.deepEqual(validate(submission({language: "de",
      idempotencyKey: "x"})).errors,
    ["language_invalid", "idempotency_key_invalid"]);
  });
});

describe("estimates", () => {
  const stored = () => ({...validate(submission()).record, status: "new"});

  it("sends version 1 by itself only when every piece is priced", () => {
    const allBarrels = validate(submission({pieces: [{kind: "barrel"},
      {kind: "barrel"}]})).record;
    const v1 = pr.automaticEstimate(allBarrels.pieces, NOW);
    assert.equal(v1.version, 1);
    assert.equal(v1.totalCents, 30000);
    assert.equal(v1.auto, true);
    assert.equal(pr.automaticEstimate(stored().pieces, NOW), null);
    const unpriced = validate(submission({pieces: [{kind: "barrel"}]}),
        option(business(), guinea({barrelShippingPrice: 0}))).record;
    assert.equal(pr.automaticEstimate(unpriced.pieces, NOW), null);
  });

  it("needs a price for every piece", () => {
    const request = stored();
    assert.deepEqual(pr.cleanEstimateInput({pieces: [{id: "p1",
      cents: 15000}]}, request, NOW).errors, ["estimate_piece_missing"]);
    assert.deepEqual(pr.cleanEstimateInput({pieces: [{id: "p1", cents: 1},
      {id: "p2", cents: -5}, {id: "p9", cents: 1}]}, request, NOW).errors,
    ["amount_invalid", "estimate_piece_unknown", "estimate_piece_missing"]);
    const ok = pr.cleanEstimateInput({pieces: [{id: "p1", cents: 15000},
      {id: "p2", cents: 4500}], note: "Box weighed"}, request, NOW);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.estimate.totalCents, 19500);
  });

  it("takes a pickup fee and schedule only for a collect request", () => {
    const request = stored();
    assert.deepEqual(pr.cleanEstimateInput({pieces: [{id: "p1", cents: 1},
      {id: "p2", cents: 1}], pickupFeeCents: 2000}, request, NOW).errors,
    ["pickup_fee_invalid"]);
    const collect = {...request, handoff: "collect"};
    const ok = pr.cleanEstimateInput({pieces: [{id: "p1", cents: 100},
      {id: "p2", cents: 100}], pickupFeeCents: 2000,
    pickupSchedule: {date: "2026-10-23", window: "morning"}}, collect, NOW);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.estimate.totalCents, 2200);
  });

  it("sends only over the current version, and not over someone's lock",
      () => {
        const request = {...stored(), status: "estimate_sent",
          estimate: {version: 2}};
        assert.equal(pr.estimateSendRefusal(request, {uid: "a", nowMs: NOW,
          baseVersion: 1}).code, "estimate_stale");
        assert.deepEqual(pr.estimateSendRefusal(request, {uid: "a",
          nowMs: NOW, baseVersion: 1}).details, {currentVersion: 2});
        assert.equal(pr.estimateSendRefusal(request, {uid: "a", nowMs: NOW,
          baseVersion: 2}), null);
        const locked = {...request, lock: {uid: "b", name: "Mariama",
          untilMs: NOW + 60000}};
        assert.deepEqual(pr.estimateSendRefusal(locked, {uid: "a",
          nowMs: NOW, baseVersion: 2}), {code: "estimate_locked",
          details: {lockedByName: "Mariama", untilMs: NOW + 60000}});
        // The holder sends; a lock that ran out stops nobody.
        assert.equal(pr.estimateSendRefusal(locked, {uid: "b", nowMs: NOW,
          baseVersion: 2}), null);
        assert.equal(pr.estimateSendRefusal(locked, {uid: "a",
          nowMs: NOW + 120000, baseVersion: 2}), null);
        assert.equal(pr.estimateSendRefusal({...request, status: "expired"},
            {uid: "a", nowMs: NOW, baseVersion: 2}).code, "request_closed");
        assert.equal(pr.estimateSendRefusal({...request,
          payment: {timing: "card"}}, {uid: "a", nowMs: NOW,
          baseVersion: 2}).code, "card_order");
      });

  it("asks again when the price goes up after confirming; tells when it " +
      "goes down", () => {
    const confirmed = {status: "confirmed", confirmedTotalCents: 20000};
    assert.deepEqual(pr.statusAfterEstimate(confirmed, 25000),
        {status: "estimate_sent", reconfirmRequired: true,
          priceDropped: false});
    assert.deepEqual(pr.statusAfterEstimate(confirmed, 18000),
        {status: "confirmed", reconfirmRequired: false, priceDropped: true});
    assert.deepEqual(pr.statusAfterEstimate(confirmed, 20000),
        {status: "confirmed", reconfirmRequired: false, priceDropped: true});
    assert.deepEqual(pr.statusAfterEstimate({status: "new"}, 1),
        {status: "estimate_sent", reconfirmRequired: false,
          priceDropped: false});
  });
});

describe("the estimate lock", () => {
  const open = {status: "new"};
  it("is taken, extended, and refused to a second person", () => {
    const first = pr.lockDecision(open, {uid: "a", nowMs: NOW});
    assert.equal(first.action, "take");
    assert.equal(first.lock.untilMs, NOW + 15 * 60 * 1000);
    const held = {...open, lock: {uid: "a", name: "Awa",
      untilMs: first.lock.untilMs}};
    assert.equal(pr.lockDecision(held, {uid: "a", nowMs: NOW + 60000})
        .action, "extend");
    const second = pr.lockDecision(held, {uid: "b", nowMs: NOW + 60000});
    assert.equal(second.action, "locked");
    assert.equal(second.previous.name, "Awa");
  });

  it("is taken over after 15 minutes idle", () => {
    const held = {...open, lock: {uid: "a", name: "Awa",
      untilMs: NOW + 15 * 60 * 1000}};
    assert.equal(pr.lockDecision(held, {uid: "b",
      nowMs: NOW + 15 * 60 * 1000}).action, "takeover");
    assert.equal(pr.lockDecision(held, {uid: "b",
      nowMs: NOW + 15 * 60 * 1000 - 1}).action, "locked");
  });

  it("is not offered on a closed or card-paid request", () => {
    assert.equal(pr.lockDecision({status: "received"}, {uid: "a",
      nowMs: NOW}).action, "closed");
    assert.equal(pr.lockDecision({status: "confirmed",
      payment: {timing: "card"}}, {uid: "a", nowMs: NOW}).action, "card");
  });
});

describe("confirming and declining (§4)", () => {
  const sent = {status: "estimate_sent", estimate: {version: 3}};
  it("confirms only the version shown", () => {
    assert.deepEqual(pr.confirmDecision(sent, 3), {action: "confirm"});
    assert.deepEqual(pr.confirmDecision(sent, 2), {action: "refuse",
      code: "estimate_changed", details: {currentVersion: 3}});
    assert.equal(pr.confirmDecision(sent, "3").code, "estimate_changed");
  });

  it("is idempotent once confirmed, and refuses closed requests", () => {
    assert.deepEqual(pr.confirmDecision({...sent, status: "confirmed"}, 1),
        {action: "already"});
    for (const status of ["expired", "cancelled", "declined",
      "customer_declined", "received"]) {
      assert.deepEqual(pr.confirmDecision({...sent, status}, 3),
          {action: "refuse", code: "request_closed", details: {status}});
    }
    assert.equal(pr.confirmDecision({status: "new"}, 1).code,
        "estimate_missing");
  });

  it("lets the customer say no thanks once", () => {
    assert.equal(pr.customerDeclineDecision(sent).action, "decline");
    assert.equal(pr.customerDeclineDecision({status: "customer_declined"})
        .action, "already");
    assert.equal(pr.customerDeclineDecision({status: "expired"}).code,
        "request_closed");
    assert.equal(pr.customerDeclineDecision({status: "confirmed",
      payment: {timing: "card"}}).code, "card_order");
  });

  it("lets staff decline before confirmation and cancel any open one", () => {
    assert.equal(pr.staffCloseRefusal({status: "new"}, "decline"), null);
    assert.equal(pr.staffCloseRefusal({status: "confirmed"}, "decline").code,
        "request_closed");
    assert.equal(pr.staffCloseRefusal({status: "confirmed"}, "cancel"), null);
    assert.equal(pr.staffCloseRefusal({status: "received"}, "cancel").code,
        "request_closed");
    assert.equal(pr.staffCloseRefusal({status: "confirmed",
      payment: {timing: "card"}}, "cancel").code, "card_order");
    assert.deepEqual(pr.cleanReason("  "), {reason: "",
      error: "reason_required"});
    assert.equal(pr.cleanReason("x".repeat(301)).error, "text_too_long");
    assert.equal(pr.cleanReason(" No longer ship there ").reason,
        "No longer ship there");
  });

  it("keeps at most 100 History entries", () => {
    let history = [];
    for (let i = 0; i < 105; i++) {
      history = pr.appendHistory(history, {atMs: i, action: "estimate_sent",
        byUid: "u", byName: "Awa", version: i});
    }
    assert.equal(history.length, 100);
    assert.equal(history[0].version, 5);
  });
});

describe("timers (§7 Timers, §8.9)", () => {
  it("alerts staff at 3 days and expires a never-estimated request at 30",
      () => {
        const request = {status: "new", createdAtMs: NOW, pieces: []};
        assert.deepEqual(pr.nextTimer(request),
            {action: "staff_alert", atMs: NOW + 3 * DAY});
        assert.deepEqual(pr.nextTimer({...request,
          reminders: {staffAlert3dAt: NOW + 3 * DAY}}),
        {action: "expire", atMs: NOW + 30 * DAY});
      });

  it("reminds once at 24 h and expires 14 days after the last version",
      () => {
        const request = {status: "estimate_sent", createdAtMs: NOW - DAY,
          estimate: {version: 2, sentAtMs: NOW}};
        assert.deepEqual(pr.nextTimer(request),
            {action: "estimate_reminder", atMs: NOW + DAY});
        assert.deepEqual(pr.nextTimer({...request,
          reminders: {estimate24hAt: NOW + DAY}}),
        {action: "expire", atMs: NOW + 14 * DAY});
      });

  it("reminds about the drop-off 3 days after the planned day, in the " +
      "business's zone", () => {
    const request = {status: "confirmed", handoff: "bring_in",
      plannedDate: "2026-10-31", timeZone: NY, confirmedAtMs: NOW};
    // Nov 3 2026, 9 AM in New York, after the DST change (EST, UTC-5).
    assert.deepEqual(pr.nextTimer(request), {action: "dropoff_reminder",
      atMs: Date.UTC(2026, 10, 3, 14, 0)});
    // Expires 30 days after the planned day (end of Nov 30 local).
    assert.equal(pr.expiryMs(request), Date.UTC(2026, 11, 1, 5, 0));
  });

  it("expires a confirmed request 30 days after confirming when that is " +
      "later", () => {
    const request = {status: "confirmed", handoff: "bring_in",
      plannedDate: "2026-10-21", timeZone: NY,
      confirmedAtMs: NOW + 10 * DAY, reminders: {dropoff3dAt: 1}};
    assert.equal(pr.expiryMs(request), NOW + 40 * DAY);
  });

  it("sends no customer reminder for a collected request", () => {
    const request = {status: "confirmed", handoff: "collect",
      pickup: {date: "2026-10-22"}, timeZone: NY, confirmedAtMs: NOW};
    assert.equal(pr.nextTimer(request).action, "expire");
  });

  it("never expires a card-paid request", () => {
    assert.equal(pr.expiryMs({status: "confirmed",
      payment: {timing: "card"}, confirmedAtMs: NOW}), 0);
    assert.equal(pr.nextTimer({status: "confirmed", handoff: "bring_in",
      payment: {timing: "card"}, confirmedAtMs: NOW}), null);
  });

  it("deletes photos 90 days after a request ends or its line is ready " +
      "for pickup", () => {
    const pieces = [{id: "p1", photoPaths: ["packageRequestPhotos/a/b/c"]}];
    assert.deepEqual(pr.nextTimer({status: "declined", closedAtMs: NOW,
      pieces}), {action: "delete_photos", atMs: NOW + 90 * DAY});
    assert.deepEqual(pr.nextTimer({status: "received", receivedAtMs: NOW,
      pieces}), {action: "check_photos", atMs: NOW + 7 * DAY});
    assert.deepEqual(pr.nextTimer({status: "received", receivedAtMs: NOW,
      pieces}, {lineArrivedAtMs: NOW + 30 * DAY}),
    {action: "delete_photos", atMs: NOW + 120 * DAY});
    assert.equal(pr.nextTimer({status: "declined", closedAtMs: NOW, pieces,
      photosDeletedAt: NOW}), null);
    assert.equal(pr.nextTimer({status: "received", pieces: []}), null);
  });
});

describe("the words in messages", () => {
  const pieces = [{kind: "barrel"}, {kind: "barrel"}, {kind: "box"},
    {kind: "other"}];
  it("counts pieces by kind in both languages", () => {
    assert.equal(pr.describePieces(pieces, "en"),
        "2 barrels, 1 box, 1 item");
    assert.equal(pr.describePieces(pieces, "fr"),
        "2 fûts, 1 carton, 1 colis");
    assert.equal(pr.describePieces([{kind: "box"}, {kind: "box"}], "en"),
        "2 boxes");
  });

  it("writes money the US way and the French way", () => {
    assert.equal(pr.moneyText(125000, "en"), "$1,250.00");
    assert.equal(pr.moneyText(125000, "fr"), "1 250,00 $");
    assert.equal(pr.moneyText(5, "en"), "$0.05");
  });

  it("writes opening hours in one line, 12-hour in English", () => {
    assert.equal(pr.hoursText(WEEK, "en"),
        "Mon–Fri 9:00 AM–6:00 PM, Sat 10:00 AM–2:00 PM");
    assert.equal(pr.hoursText(WEEK, "fr"),
        "lun.–ven. 9 h 00–18 h 00, sam. 10 h 00–14 h 00");
    assert.equal(pr.hoursText({}, "en"), "by appointment");
  });

  it("fills the estimate template in its approved order with the token " +
      "button", () => {
    assert.equal(requestTemplateForUpdate("estimate_v3"),
        REQUEST_TEMPLATE.PACKAGE_ESTIMATE_2LANG);
    assert.equal(requestTemplateForUpdate("estimate_reminder"),
        REQUEST_TEMPLATE.PACKAGE_ESTIMATE_2LANG);
    assert.equal(requestTemplateForUpdate("dropoff_reminder"),
        REQUEST_TEMPLATE.PACKAGE_DROPOFF_REMINDER_2LANG);
    assert.equal(requestTemplateForUpdate("received"), null);
    assert.equal(REQUEST_TEMPLATE_VARIABLES.package_estimate_2lang.length,
        10);
    assert.equal(REQUEST_TEMPLATE_VARIABLES
        .package_dropoff_reminder_2lang.length, 8);
    const request = {sender: {name: "Fatou"}, businessName: "Dala Shipping",
      estimate: {totalCents: 19500}, pieces, destinationCountryName: "Guinea",
      code: "R-K7M4P", token: "t".repeat(43)};
    const values = pr.requestMessageValues(request,
        {destinationFr: "Guinée", hours: WEEK});
    const body = requestTemplateMessage({phone: "+1 646 555 0100",
      update: "estimate_v2", values});
    assert.equal(body.to, "16465550100");
    assert.equal(body.template.name, "package_estimate_2lang");
    assert.equal(body.template.language.code, "en");
    assert.deepEqual(body.template.components[0].parameters.map((p) =>
      p.text), ["Fatou", "Dala Shipping", "$195.00",
      "2 barrels, 1 box, 1 item", "Guinea", "Dala Shipping", "195,00 $",
      "2 fûts, 1 carton, 1 colis", "Guinée", "R-K7M4P"]);
    assert.deepEqual(body.template.components[1].parameters,
        [{type: "text", text: "t".repeat(43)}]);
    const reminder = requestTemplateMessage({phone: "+16465550100",
      update: "dropoff_reminder", values});
    assert.deepEqual(reminder.template.components[0].parameters.map((p) =>
      p.text), ["Fatou", "Dala Shipping", "2 barrels, 1 box, 1 item",
      "Mon–Fri 9:00 AM–6:00 PM, Sat 10:00 AM–2:00 PM", "Dala Shipping",
      "2 fûts, 1 carton, 1 colis",
      "lun.–ven. 9 h 00–18 h 00, sam. 10 h 00–14 h 00", "R-K7M4P"]);
  });
});

describe("what the /e/ page sees", () => {
  it("holds no phone numbers, photos, lock or staff names", () => {
    const record = {...validate(submission({pieces: [{kind: "box",
      description: "TV", photoPaths:
        ["packageRequestPhotos/dala/anon-1/photo-1-abcdef.jpg"]}]})).record,
    status: "estimate_sent", code: "R-K7M4P", token: "secret",
    lock: {uid: "staff", name: "Awa", untilMs: NOW},
    estimate: {version: 1, totalCents: 4500, pieces: [{id: "p1",
      cents: 4500}], sentByName: "Awa", sentByUid: "staff", sentAtMs: NOW},
    confirmedAtMs: NOW};
    const view = pr.publicRequestView("req1", record, business(),
        {hours: WEEK});
    const json = JSON.stringify(view);
    for (const secret of ["+16465550100", "+224", "packageRequestPhotos", "Awa",
      "staff", "secret"]) {
      assert.ok(!json.includes(secret), secret);
    }
    assert.equal(view.pieces[0].photoCount, 1);
    assert.equal(view.estimate.version, 1);
    assert.equal(view.business.phone, "+16465550199");
    assert.equal(view.location.hours.sat.from, "10:00");
    assert.equal(view.confirmedAt, new Date(NOW).toISOString());
  });
});

describe("card barrel orders (§8.10)", () => {
  const shipment = {businessId: "dala", orderId: "o1", quantity: 3,
    unitShippingFee: 150, shippingFee: 450, cardChargeAmountCents: 45000,
    senderName: "Fatou", customerPhone: "+16465550100", customerUid: "u1",
    receiverName: "Mariama", receiverPhone: "+224620000000",
    destinationCountryId: "gn", destinationCountryName: "Guinea",
    pickupRequested: false, officeLocationId: "bronx",
    officeLocationLabel: "Bronx", pickupAddress: "410 E 138th St"};

  it("becomes a confirmed, paid, card request with priced barrels", () => {
    const body = pr.cardRequestFromShipment(shipment, {shipmentId: "s1",
      businessName: "Dala", nowMs: NOW, timeZone: NY});
    assert.equal(body.status, "confirmed");
    assert.equal(body.confirmedVia, "card");
    assert.deepEqual(body.payment, {timing: "card", paidCents: 45000});
    assert.equal(body.pieces.length, 3);
    assert.ok(body.pieces.every((p) => p.kind === "barrel" &&
      p.estimateCents === 15000));
    assert.equal(body.estimate.totalCents, 45000);
    assert.deepEqual(body.cardOrder, {orderId: "o1", shipmentId: "s1"});
    assert.equal(body.sender.uid, "u1");
    assert.equal(pr.cardRequestFromShipment({...shipment, isGuest: true},
        {shipmentId: "s1", nowMs: NOW}).sender.uid, undefined);
  });

  it("keeps the pickup fee of a collected order", () => {
    const body = pr.cardRequestFromShipment({...shipment,
      pickupRequested: true, cardChargeAmountCents: 49000,
      pickupDateTime: new Date(Date.UTC(2026, 9, 22, 14))},
    {shipmentId: "s1", nowMs: NOW, timeZone: NY});
    assert.equal(body.handoff, "collect");
    assert.equal(body.estimate.pickupFeeCents, 4000);
    assert.equal(body.estimate.totalCents, 49000);
    assert.equal(body.pickup.date, "2026-10-22");
  });

  it("ends when the shipment is cancelled or refunded", () => {
    assert.ok(pr.shipmentEndsCardRequest({status: "cancelled"}));
    assert.ok(pr.shipmentEndsCardRequest({paymentStatus: "refunded"}));
    assert.ok(!pr.shipmentEndsCardRequest({status: "pending",
      paymentStatus: "succeeded"}));
  });
});

describe("staff notifications (§8.7)", () => {
  it("speaks the reader's language", () => {
    const request = {sender: {name: "Fatou"}, code: "R-K7M4P",
      pieces: [{kind: "barrel"}]};
    assert.deepEqual(pr.requestNotificationText("new", request, "en"),
        {title: "New package request", body: "Fatou · 1 barrel · R-K7M4P"});
    assert.deepEqual(pr.requestNotificationText("confirmed", request, "fr"),
        {title: "Estimation acceptée", body: "Fatou · 1 fût · R-K7M4P"});
  });
});

describe("the line Received writes (§7 line fields)", () => {
  const request = {
    handoff: "bring_in",
    sender: {name: "Fatou Diallo", phoneE164: "+16465550100"},
    receiver: {name: "Mariama Bah", phoneE164: "+224620000000"},
    destinationCountryId: "gn", destinationCountryName: "Guinea",
    pieces: [{id: "p1", kind: "barrel", description: "", estimateCents: 15000},
      {id: "p2", kind: "box", description: "Clothes", estimateCents: null}],
    estimate: {version: 1, pieces: [{id: "p1", cents: 15000},
      {id: "p2", cents: 4500}]},
    payment: {timing: "at_handoff", paidCents: 0},
  };
  const prices = (out) => out.pieces.map((p) => [p.id, p.priceCents]);

  it("prefills final prices from the estimate and refuses half-priced " +
      "loads", () => {
    const out = rr.cleanReceivePieces([{id: "p1"},
      {id: "p2", priceCents: 5000}], request);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(prices(out), [["p1", 15000], ["p2", 5000]]);
    assert.equal(rr.receivedTotalCents(out.pieces), 20000);
    // An empty list keeps every piece at its estimate.
    assert.deepEqual(prices(rr.cleanReceivePieces([], request)),
        [["p1", 15000], ["p2", 4500]]);
    assert.deepEqual(rr.cleanReceivePieces([{id: "p1", priceCents: null},
      {id: "p2"}], request).errors, ["price_required"]);
    assert.deepEqual(rr.cleanReceivePieces([{id: "zz", priceCents: 1},
      {id: "p1", priceCents: -1}], request).errors,
    ["estimate_piece_unknown", "price_invalid"]);
    assert.deepEqual(rr.cleanReceivePieces([{id: "p1"}, {id: "p1"}], request)
        .errors, ["estimate_piece_unknown"]);
    const none = rr.cleanReceivePieces([{id: "p1", priceCents: null},
      {id: "p2", priceCents: null}], request);
    assert.deepEqual(none.errors, []);
    assert.equal(rr.receivedTotalCents(none.pieces), null);
  });

  it("writes one waiting line with every §7 field", () => {
    const line = rr.requestLineRecord(request, {lineId: "line1",
      requestId: "req1", payOnArrival: false, staffUid: "staff1",
      receivedAt: "TS"});
    for (const field of rr.REQUEST_LINE_FIELDS) {
      assert.ok(field in line, field);
    }
    assert.equal(line.containerId, "");
    assert.equal(line.containerStatus, "waiting");
    assert.equal(line.kind, "other");
    assert.equal(line.quantity, 2);
    // phase 1's summary for old apps (piecesSummaryFields).
    assert.equal(line.description, "Barrel, Clothes");
    assert.equal(line.priceCents, 19500);
    assert.equal(line.paidCents, 0);
    assert.equal(line.pieceCount, 2);
    assert.equal(line.barrelPieces, 1);
    assert.equal(line.packagePieces, 1);
    assert.equal(line.carPieces, 0);
    assert.equal(line.source, "request");
    assert.equal(line.requestId, "req1");
    assert.equal(line.rootLineId, "line1");
    assert.equal(line.partIndex, 1);
    assert.equal(line.receivedAt, "TS");
    assert.equal("receivedAtMs" in line, false);
    assert.equal(line.customerPhone, "+16465550100");
    assert.equal(line.receiverPhone, "+224620000000");
    assert.equal(line.notifyCustomer, true);
    assert.deepEqual(line.pieces, [
      {id: "p1", kind: "barrel", description: "", sizeIn: null,
        priceCents: 15000},
      {id: "p2", kind: "box", description: "Clothes", sizeIn: null,
        priceCents: 4500}]);
  });

  it("is the same document as the counter's line for the same pieces",
      () => {
        const {containerLineRecord, lineReceiptFields} =
          require("../container_manifest");
        const pieces = [
          {kind: "barrel", description: "", priceCents: 15000},
          {kind: "box", description: "Clothes and shoes",
            sizeIn: {l: 24, w: 18, h: 18}, priceCents: 4500},
          {kind: "other", description: "TV", priceCents: 6000}];
        const counter = {
          ...containerLineRecord({kind: "other", pieces, ownerKind: "customer",
            customerName: "Fatou Diallo", customerPhone: "+16465550100",
            receiverName: "Mariama Bah", receiverPhone: "+224620000000",
            notifyCustomer: true, notifyReceiver: true,
            destinationCountryId: "gn", destinationCountryName: "Guinea",
            payOnArrival: false},
          {containerId: "", containerStatus: "waiting",
            addedByStaffId: "staff1"}),
          ...lineReceiptFields({lineId: "line1", source: "counter",
            requestId: "", receivedAt: "TS"}),
        };
        const asked = {...request, pieces: pieces.map((p, i) => ({
          id: `p${i + 1}`, kind: p.kind, description: p.description,
          sizeIn: p.sizeIn || null, estimateCents: p.priceCents})),
        estimate: null};
        const received = rr.requestLineRecord(asked, {lineId: "line1",
          requestId: "req1", staffUid: "staff1", receivedAt: "TS"});
        assert.deepEqual(Object.keys(received).sort(),
            Object.keys(counter).sort());
        assert.deepEqual({...received, source: "counter", requestId: ""},
            counter);
        assert.equal(received.source, "request");
        assert.equal(received.description, "Barrel, Clothes and shoes, TV");

        // Labels: one per piece, "1 of 3", each piece's own name and size.
        const {containerLabelsModel} = require("../container_labels");
        const model = containerLabelsModel({container: null,
          lines: [{...received, trackingCode: "CL-K7M4P2"}],
          business: {name: "Dala"}, consoleUrl: "https://example.test",
          copies: 1});
        assert.deepEqual(model.labels.map((l) =>
          [l.packageNumber, l.packageCount, l.what, l.size]), [
          [1, 3, "Barrel", ""],
          [2, 3, "Clothes and shoes", "24 × 18 × 18 in"],
          [3, 3, "TV", ""]]);

        // Split: two of the three go, one stays as part 2.
        const lp = require("../line_pieces");
        const split = lp.splitPieces(received, 2);
        assert.equal(split.split, true);
        assert.deepEqual(split.going.map((p) => p.id), ["p1", "p2"]);
        assert.deepEqual(split.staying.map((p) => p.id), ["p3"]);

        // Monthly volume reads it like a counter line.
        const vc = require("../volume_counts");
        assert.deepEqual(vc.linePieces(received), vc.linePieces(counter));
        assert.deepEqual(vc.linePieces(received),
            {pieces: 3, barrels: 1, packages: 2, cars: 0});
      });

  it("takes a piece the customer brought on top, drops one that did not " +
      "come, and corrects what one is", () => {
    const out = rr.cleanReceivePieces([{id: "p2", priceCents: 5000,
      description: "Clothes and shoes", sizeIn: {l: 20, w: 20, h: 20}},
    {kind: "box", description: "Shoes", priceCents: 3000}], request);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.pieces.map((p) => [p.id, p.kind, p.description]),
        [["p2", "box", "Clothes and shoes"], ["p3", "box", "Shoes"]]);
    assert.deepEqual(out.pieces[0].sizeIn, {l: 20, w: 20, h: 20});
    assert.equal(out.added, 1);
    assert.equal(out.removed, 1);
    assert.equal(rr.receivedTotalCents(out.pieces), 8000);
    const line = rr.requestLineRecord(request, {lineId: "l", requestId: "r",
      pieces: out.pieces, staffUid: "s", receivedAt: "TS"});
    assert.equal(line.pieceCount, 2);
    assert.equal(line.barrelPieces, 0);
    assert.equal(line.kind, "other");
    assert.deepEqual(line.pieces.map((p) => p.priceCents), [5000, 3000]);
    assert.deepEqual(rr.cleanReceivePieces([{kind: "tv", priceCents: 1},
      {kind: "other", priceCents: 1}], request).errors,
    ["piece_kind_invalid", "piece_description_required"]);
    assert.deepEqual(rr.cleanReceivePieces([{id: "p1",
      sizeIn: {l: 10, w: "", h: 5}}], request).errors, ["size_invalid"]);
    assert.deepEqual(rr.cleanReceivePieces([{kind: "box",
      description: "x".repeat(121), priceCents: 1}], request).errors,
    ["text_too_long"]);
    const many = Array.from({length: 21}, () => ({kind: "barrel",
      priceCents: 1}));
    assert.deepEqual(rr.cleanReceivePieces(many, request).errors,
        ["too_many_pieces"]);
  });

  it("calls an all-barrel load barrels, and a card one card_order", () => {
    const barrels = {...request, pieces: [{id: "p1", kind: "barrel"},
      {id: "p2", kind: "barrel"}], estimate: null,
    payment: {timing: "card", paidCents: 30000}};
    const out = rr.cleanReceivePieces([{id: "p1", priceCents: 15000},
      {id: "p2", priceCents: 15000}], barrels);
    const line = rr.requestLineRecord(barrels, {lineId: "l", requestId: "r",
      pieces: out.pieces, staffUid: "s", receivedAt: "TS"});
    assert.equal(line.kind, "barrels");
    assert.equal(line.quantity, 2);
    assert.equal(line.description, "");
    assert.equal(line.source, "card_order");
  });

  it("keeps a collected request's pickup fee beside the pieces", () => {
    const collect = {...request, handoff: "collect",
      estimate: {...request.estimate, pickupFeeCents: 2501}};
    // Owner decision 2026-10-18: the pieces open on the estimate's own
    // prices, the fee is the line's own amount (the same numbers in the
    // console's and the app's suites).
    assert.deepEqual([...rr.receivePrefillCents(collect)],
        [["p1", 15000], ["p2", 4500]]);
    assert.equal(rr.receivePrefillPickupFeeCents(collect), 2501);
    const out = rr.cleanReceivePieces([], collect);
    const fee = rr.cleanReceivePickupFee(undefined, collect);
    assert.deepEqual(fee, {pickupFeeCents: 2501, errors: []});
    assert.equal(rr.receivedTotalCents(out.pieces, fee.pickupFeeCents),
        22001);
    const line = rr.requestLineRecord(collect, {lineId: "l", requestId: "r",
      pieces: out.pieces, staffUid: "s", receivedAt: "TS"});
    assert.equal(line.pickupFeeCents, 2501);
    assert.equal(line.priceCents, 22001);
    assert.deepEqual(line.pieces.map((p) => p.priceCents), [15000, 4500]);
    // Staff may change it, to anything whole and not negative.
    assert.deepEqual(rr.cleanReceivePickupFee(2000, collect),
        {pickupFeeCents: 2000, errors: []});
    assert.deepEqual(rr.cleanReceivePickupFee(0, collect),
        {pickupFeeCents: 0, errors: []});
    for (const bad of [-1, 12.5, "", "abc"]) {
      assert.deepEqual(rr.cleanReceivePickupFee(bad, collect).errors,
          ["pickup_fee_invalid"], String(bad));
    }
    const typed = rr.requestLineRecord(collect, {lineId: "l", requestId: "r",
      pieces: out.pieces, pickupFeeCents: 2000, staffUid: "s",
      receivedAt: "TS"});
    assert.equal(typed.priceCents, 21500);
    // A bring-in request has no fee: none prefilled, none taken.
    assert.deepEqual([...rr.receivePrefillCents(request)],
        [["p1", 15000], ["p2", 4500]]);
    assert.equal(rr.receivePrefillPickupFeeCents(request), 0);
    const brought = rr.requestLineRecord(request, {lineId: "l",
      requestId: "r", staffUid: "s", receivedAt: "TS"});
    assert.equal("pickupFeeCents" in brought, false);
    assert.equal(brought.priceCents, 19500);
    assert.deepEqual(rr.cleanReceivePickupFee(2000, request).errors,
        ["pickup_fee_invalid"]);
    assert.deepEqual(rr.cleanReceivePickupFee(0, request),
        {pickupFeeCents: 0, errors: []});
    // Nothing priced yet: the fee waits on the line, no total until the
    // pieces have prices.
    const unpriced = {...collect, estimate: {pickupFeeCents: 2500},
      pieces: [{id: "p1", kind: "box", description: "TV"}]};
    assert.deepEqual([...rr.receivePrefillCents(unpriced)], [["p1", null]]);
    const waiting = rr.requestLineRecord(unpriced, {lineId: "l",
      requestId: "r", staffUid: "s", receivedAt: "TS"});
    assert.equal(waiting.pickupFeeCents, 2500);
    assert.equal(waiting.priceCents, null);
  });

  it("counts the same pieces with or without a pickup fee", () => {
    const collect = {...request, handoff: "collect",
      estimate: {...request.estimate, pickupFeeCents: 2000}};
    const withFee = rr.requestLineRecord(collect, {lineId: "l",
      requestId: "r", staffUid: "s", receivedAt: "TS"});
    const without = rr.requestLineRecord(collect, {lineId: "l",
      requestId: "r", pickupFeeCents: 0, staffUid: "s", receivedAt: "TS"});
    for (const key of ["pieceCount", "barrelPieces", "packagePieces",
      "carPieces", "quantity"]) {
      assert.equal(withFee[key], without[key], key);
    }
    assert.deepEqual(volume.linePieces(withFee), volume.linePieces(without));
    // Changing only the fee touches no month's rollup and no container's.
    const stored = {...without, businessId: "b1", createdAt: new Date()};
    assert.deepEqual(volume.lineWriteTargets({before: stored,
      after: {...stored, pickupFeeCents: 2000, priceCents: 21500},
      id: "l"}), {months: [], containerIds: []});
  });
});
