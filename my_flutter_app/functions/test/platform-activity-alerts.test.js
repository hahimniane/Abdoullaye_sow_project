"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const pa = require("../platform_activity_alerts");
const sa = require("../staff_activity_alerts");
const {normalizeNotificationPreferences} = require("../notification_settings");

const NOW = Date.UTC(2026, 9, 22, 15, 0, 0);
const MIN = 60 * 1000;

const admins = [
  {id: "super", role: "admin", adminRole: "superAdmin"},
  {id: "ops", role: "admin", adminRole: "operationsManager",
    preferredLanguage: "fr"},
  {id: "finance", role: "admin", adminRole: "financeManager"},
  {id: "support", role: "admin", adminRole: "supportAdmin"},
  {id: "legacy", role: "admin"},
  {id: "muted", role: "admin", adminRole: "superAdmin",
    notificationPreferences: {platformActivity: false}},
  {id: "blocked", role: "admin", adminRole: "superAdmin",
    accountStatus: "suspended"},
  {id: "owner-admin", role: "admin", adminRole: "superAdmin"},
  {id: "staff", role: "staff", adminRole: "superAdmin", businessId: "biz"},
];
const isBlocked = (user) => user.accountStatus === "suspended";
const uids = (list) => list.map((entry) => entry.uid);

describe("platform activity: which records", () => {
  it("a car and a package follow the staff alerts' rules", () => {
    const car = {businessId: "biz", enteredByUid: "mamadou",
      createdAt: NOW - MIN};
    assert.deepEqual(pa.platformEventFor("car", car, "c1", NOW),
        {businessId: "biz", actorUid: "mamadou"});
    // A customer's online reservation is not a car parked.
    assert.equal(pa.platformEventFor("car", {businessId: "biz",
      customerUid: "cust", createdAt: NOW}, "c2", NOW).skip, "no_actor");
    // A split part is the same package.
    assert.equal(pa.platformEventFor("package", {businessId: "biz",
      addedByStaffId: "a", splitFromLineId: "l0", rootLineId: "l0",
      createdAt: NOW}, "l1", NOW).skip, "not_new");
  });

  it("a sale names its seller; voided, old or ownerless ones do not", () => {
    const sale = {businessId: "biz", soldByStaffId: "seller", voided: false,
      createdAt: {seconds: NOW / 1000}, totalCents: 24000,
      lines: [{quantity: 2}, {quantity: 1}]};
    assert.deepEqual(pa.platformEventFor("sale", sale, "s1", NOW),
        {businessId: "biz", actorUid: "seller"});
    assert.equal(pa.platformEventFor("sale", {...sale, voided: true}, "s1",
        NOW).skip, "voided");
    assert.equal(pa.platformEventFor("sale", {...sale,
      createdAt: NOW - 2 * 60 * MIN}, "s1", NOW).skip, "stale");
    assert.equal(pa.platformEventFor("sale", {...sale, createdAt: null},
        "s1", NOW).skip, "stale");
    assert.equal(pa.platformEventFor("sale", {...sale, businessId: ""},
        "s1", NOW).skip, "no_business");
    assert.equal(pa.platformEventFor("sale", {...sale, soldByStaffId: ""},
        "s1", NOW).skip, "no_actor");
    assert.equal(pa.platformEventFor("barrel", sale, "s1", NOW).skip,
        "bad_kind");
    assert.equal(pa.salePieces(sale), 3);
  });
});

describe("platform activity: who hears", () => {
  it("super admins and operations managers only", () => {
    assert.deepEqual(uids(pa.planPlatformRecipients({admins, isBlocked})),
        ["ops", "owner-admin", "super"]);
  });

  it("never the actor, nor an owner who already gets the staff alert", () => {
    assert.deepEqual(uids(pa.planPlatformRecipients({admins, isBlocked,
      actorUid: "super", ownerUids: ["owner-admin"]})), ["ops"]);
  });

  it("is capped", () => {
    const many = Array.from({length: 30}, (_, i) => ({id: `a${i}`,
      role: "admin", adminRole: "superAdmin"}));
    assert.equal(pa.planPlatformRecipients({admins: many}).length,
        pa.MAX_PLATFORM_RECIPIENTS);
  });

  it("the preference is on unless switched off", () => {
    assert.equal(normalizeNotificationPreferences({}).platformActivity, true);
    assert.equal(normalizeNotificationPreferences(
        {platformActivity: false}).platformActivity, false);
  });
});

describe("platform activity: what they read", () => {
  const base = {businessId: "biz", businessName: "Diallo Shipping",
    admins, isBlocked, actorUid: "aissatou", actorName: "Aissatou"};

  it("a car: the business is the title, the staff sentence the body", () => {
    const plan = pa.planPlatformAlert({...base, kind: "car", recordId: "c1",
      record: {carYear: "2018", carMake: "Toyota", carModel: "Camry",
        trackingCode: "PK-1"}});
    const en = plan.recipients.find((r) => r.uid === "super");
    const fr = plan.recipients.find((r) => r.uid === "ops");
    assert.deepEqual({title: en.title, body: en.body}, {
      title: "Diallo Shipping",
      body: "Aissatou parked a 2018 Toyota Camry · PK-1"});
    assert.equal(fr.body, "Aissatou a garé une Toyota Camry 2018 · PK-1");
    assert.deepEqual(plan.data, {type: "platform_activity",
      businessId: "biz", kind: "car", summary: "false",
      relatedCollection: "parkedCars", relatedId: "c1"});
  });

  it("a package shows its price to an admin", () => {
    const plan = pa.planPlatformAlert({...base, kind: "package",
      recordId: "l1", record: {customerName: "Fatou", priceCents: 4500,
        containerId: "box"}, container: {containerNumber: "MSKU1"}});
    assert.equal(plan.recipients[0].body,
        sa.packageAlertCopy({customerName: "Fatou", priceCents: 4500,
          containerId: "box"}, {containerNumber: "MSKU1"}, "Aissatou",
        plan.recipients[0].language, true).body);
    assert.match(plan.recipients.find((r) => r.uid === "super").body,
        /\$45\.00/);
  });

  it("a sale: pieces and total, in each language", () => {
    const record = {totalCents: 24000, lines: [{quantity: 3}]};
    const plan = pa.planPlatformAlert({...base, kind: "sale",
      recordId: "s1", record});
    assert.equal(plan.recipients.find((r) => r.uid === "super").body,
        "Aissatou sold 3 pieces · $240.00");
    assert.equal(plan.recipients.find((r) => r.uid === "ops").body,
        "Aissatou a vendu 3 articles · $240.00");
    assert.equal(plan.data.relatedCollection, "inventorySales");
  });

  it("no business name still reads", () => {
    assert.equal(pa.platformEventCopy({kind: "sale", businessName: "",
      record: {totalCents: 100, lines: [{quantity: 1}]}, actorName: "",
      language: "en"}).title, "A business");
  });

  it("a summary names the busiest people first, the rest as others", () => {
    let tally = {};
    const add = (actorUid, actorName, kind, times, cents = 0) => {
      for (let i = 0; i < times; i += 1) {
        tally = pa.addToTally(tally, {kind, actorUid, actorName, cents});
      }
    };
    add("a", "Aissatou", "package", 12);
    add("a", "Aissatou", "car", 2);
    add("m", "Moussa", "sale", 3, 8000);
    add("k", "Kadi", "car", 1);
    add("o", "Ousmane", "package", 1);
    add("f", "Fatou", "package", 1);
    assert.equal(pa.tallyTotal(tally), 20);
    const en = pa.platformSummaryCopy("Diallo Shipping", tally, "en");
    assert.equal(en.title, "Diallo Shipping · more activity");
    assert.equal(en.body, "Aissatou: 12 packages, 2 cars · " +
      "Moussa: 3 sales ($240.00) · Fatou: 1 package · Kadi: 1 car · " +
      "+1 other");
    const fr = pa.platformSummaryCopy("Diallo Shipping", tally, "fr");
    assert.equal(fr.title, "Diallo Shipping · autre activité");
    assert.match(fr.body,
        /^Aissatou : 12 colis, 2 voitures · Moussa : 3 ventes/);
  });

  it("an empty summary goes to nobody", () => {
    assert.equal(pa.planPlatformSummary({businessId: "biz", tally: {},
      admins}).recipients.length, 0);
    const plan = pa.planPlatformSummary({businessId: "biz",
      businessName: "X", admins, isBlocked,
      tally: {a: {name: "A", car: 1}}});
    assert.deepEqual(uids(plan.recipients), ["ops", "owner-admin", "super"]);
    assert.equal(plan.data.summary, "true");
    assert.equal(plan.data.relatedId, "");
  });
});

describe("platform activity: one window per business", () => {
  const ev = (actorUid, kind = "package", cents = 0) => ({kind, actorUid,
    actorName: actorUid.toUpperCase(), cents});

  it("sends the first, tallies the rest, flushes one summary", () => {
    let state = null;
    let step = pa.planPlatformWindowEvent(state, ev("a"), NOW);
    assert.equal(step.action, "send");
    state = step.next;
    step = pa.planPlatformWindowEvent(state, ev("a"), NOW + MIN);
    assert.equal(step.action, "hold");
    state = step.next;
    step = pa.planPlatformWindowEvent(state, ev("m", "sale", 500),
        NOW + 2 * MIN);
    state = step.next;
    assert.equal(state.pending, 2);
    assert.deepEqual(state.tally, {
      a: {name: "A", package: 1},
      m: {name: "M", sale: 1, saleCents: 500}});
    // Not yet due.
    const early = pa.planPlatformWindowFlush(state, NOW + 5 * MIN);
    assert.equal(early.flush, false);
    const flush = pa.planPlatformWindowFlush(state, NOW + 11 * MIN);
    assert.equal(flush.flush, true);
    assert.deepEqual(flush.tally, state.tally);
    assert.deepEqual(flush.next, {pending: 0, flushDueMs: null, tally: {}});
  });

  it("an event after the window, before the flush, sends both now", () => {
    let state = pa.planPlatformWindowEvent(null, ev("a"), NOW).next;
    state = pa.planPlatformWindowEvent(state, ev("a", "car"), NOW + MIN).next;
    const step = pa.planPlatformWindowEvent(state, ev("m"), NOW + 12 * MIN);
    assert.equal(step.action, "summary");
    assert.deepEqual(step.tally, {a: {name: "A", car: 1},
      m: {name: "M", package: 1}});
    assert.deepEqual(step.next.tally, {});
    assert.equal(step.next.pending, 0);
  });

  it("stale windows are dropped, empty ones left alone", () => {
    let state = pa.planPlatformWindowEvent(null, ev("a"), NOW).next;
    state = pa.planPlatformWindowEvent(state, ev("a"), NOW + MIN).next;
    const late = pa.planPlatformWindowFlush(state, NOW + 5 * 60 * MIN);
    assert.equal(late.flush, false);
    assert.deepEqual(late.next.tally, {});
    const idle = pa.planPlatformWindowEvent(null, ev("a"), NOW).next;
    assert.equal(pa.planPlatformWindowFlush(idle, NOW + 20 * MIN).next, null);
  });

  it("claims are per kind and record", () => {
    assert.equal(pa.platformClaimId("sale", "s1"), "sale_s1");
    assert.notEqual(pa.platformClaimId("car", "x"),
        pa.platformClaimId("package", "x"));
  });
});
