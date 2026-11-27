"use strict";

// docs/FLEET.md section 18: Fleet alerts to admins - who hears, what they
// read (English and French), the push data, and the grouping through the
// staff-activity window. Synthetic data only.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const fa = require("../fleet_admin_alerts");
const sa = require("../staff_activity_alerts");
const {normalizeNotificationPreferences} = require("../notification_settings");

const people = [
  {id: "owner", role: "businessOwner", businessId: "biz",
    fullName: "Ibrahima Test", preferredLanguage: "fr"},
  {id: "admin", role: "staff", businessId: "biz", fullName: "Moussa Test",
    businessPermissions: ["fleet", "fleet_admin"]},
  {id: "full", role: "staff", businessId: "biz", fullName: "Awa Test",
    fullAccess: true},
  {id: "clerk", role: "staff", businessId: "biz", fullName: "Kadi Test",
    businessPermissions: ["fleet"]},
  {id: "parking", role: "staff", businessId: "biz",
    businessPermissions: ["parking"]},
  {id: "needsonly", role: "staff", businessId: "biz",
    businessPermissions: ["fleet_admin"],
    notificationPreferences: {fleetAlerts: "needs"}},
  {id: "muted", role: "staff", businessId: "biz",
    businessPermissions: ["fleet_admin"],
    notificationPreferences: {fleetAlerts: "off"}},
  {id: "blocked", role: "staff", businessId: "biz",
    businessPermissions: ["fleet_admin"], accountStatus: "suspended"},
  {id: "foreign", role: "staff", businessId: "other",
    businessPermissions: ["fleet_admin"]},
  {id: "foreign-owner", role: "businessOwner", businessId: "other"},
  {id: "customer", role: "customer", businessId: "biz"},
  {id: "superadmin", role: "admin"},
];
const isBlocked = (user) => user.accountStatus === "suspended";
const uids = (list) => list.map((entry) => entry.uid);
const who = (kind, actorUid = "", extra = {}) => uids(
    fa.planFleetRecipients({kind, businessId: "biz", users: people, actorUid,
      isBlocked, ...extra}));

describe("fleet alerts: who hears", () => {
  it("owner, full access and fleet_admin; owner first", () => {
    assert.deepEqual(who(fa.KIND.PLATE_ADDED),
        ["owner", "admin", "full"]);
  });

  it("never the person who did it", () => {
    assert.ok(!who(fa.KIND.PLATE_ADDED, "admin").includes("admin"));
    assert.ok(!who(fa.KIND.PAYMENT_RECORDED, "owner").includes("owner"));
    assert.deepEqual(who(fa.KIND.DRIVER_ADDED, "full"), ["owner", "admin"]);
  });

  it("an event with no admin behind it goes to every admin", () => {
    for (const actor of ["", "bank", "schedule"]) {
      assert.deepEqual(who(fa.KIND.DEPOSIT_WAITING, actor),
          ["owner", "admin", "full", "needsonly"]);
    }
  });

  it("not fleet staff, customers, other businesses, blocked, off", () => {
    const all = who(fa.KIND.DEPOSIT_WAITING);
    for (const out of ["clerk", "parking", "customer", "foreign",
      "foreign-owner", "superadmin", "blocked", "muted"]) {
      assert.ok(!all.includes(out), out);
    }
  });

  it("'needs' hears only the Needs you kinds; unknown = all", () => {
    for (const kind of [fa.KIND.DEPOSIT_WAITING,
      fa.KIND.CLAIM_NEEDS_OFFICE, fa.KIND.BANK_TOOK_BACK]) {
      assert.ok(who(kind).includes("needsonly"), kind);
    }
    for (const kind of [fa.KIND.PLATE_ADDED, fa.KIND.DRIVER_ADDED,
      fa.KIND.PAYMENT_RECORDED, fa.KIND.BANK_MATCHED]) {
      assert.ok(!who(kind).includes("needsonly"), kind);
    }
    const odd = [{id: "x", role: "staff", businessId: "biz",
      businessPermissions: ["fleet_admin"],
      notificationPreferences: {fleetAlerts: "weird"}}];
    assert.deepEqual(uids(fa.planFleetRecipients({kind: fa.KIND.PLATE_ADDED,
      businessId: "biz", users: odd})), ["x"]);
  });

  it("the business document's owner counts even without a businessId", () => {
    const users = [{id: "boss", role: "staff"}];
    assert.deepEqual(uids(fa.planFleetRecipients({kind: fa.KIND.PLATE_ADDED,
      businessId: "biz", users, ownerUids: ["boss"]})), ["boss"]);
  });

  it("an unknown kind tells nobody", () => {
    assert.deepEqual(who("something_else"), []);
  });
});

describe("fleet alerts: kinds and levels (the contract)", () => {
  it("levels", () => {
    assert.deepEqual(Object.fromEntries(Object.entries(fa.KIND_LEVEL)), {
      deposit_waiting: "needs", claim_needs_office: "needs",
      bank_took_back: "needs", plate_added: "info", driver_added: "info",
      payment_recorded: "info", bank_matched: "info"});
    assert.deepEqual([...fa.GROUPED_KINDS],
        ["plate_added", "driver_added", "payment_recorded"]);
  });
});

describe("fleet alerts: the preference", () => {
  it("is all | needs | off, default all", () => {
    assert.equal(normalizeNotificationPreferences({}).fleetAlerts, "all");
    assert.equal(fa.normalizeFleetAlertSetting("needs"), "needs");
    assert.equal(fa.normalizeFleetAlertSetting(undefined), "all");
    assert.equal(fa.normalizeFleetAlertSetting(false), "all");
  });
});

describe("fleet alerts: the words", () => {
  const copy = (event, actor, lang) => fa.fleetAlertCopy(event, actor, lang);

  it("plate, driver, payment", () => {
    assert.deepEqual(copy({kind: "plate_added", plate: "T123456C"},
        "Moussa", "en"),
    {title: "Plate added", body: "Moussa added plate T123456C"});
    assert.deepEqual(copy({kind: "plate_added", plate: "T123456C"},
        "Moussa", "fr"),
    {title: "Plaque ajoutée", body: "Moussa a ajouté la plaque T123456C"});
    assert.deepEqual(copy({kind: "driver_added", driverName: "Awa Bah"},
        "Moussa", "en"),
    {title: "Driver added", body: "Moussa added driver Awa Bah"});
    assert.deepEqual(copy({kind: "driver_added", driverName: "Awa Bah"},
        "Moussa", "fr"),
    {title: "Chauffeur ajouté", body: "Moussa a ajouté le chauffeur Awa Bah"});
    const pay = {kind: "payment_recorded", driverName: "Awa Bah",
      amountCents: 85000};
    assert.deepEqual(copy(pay, "Moussa", "en"),
        {title: "Payment recorded",
          body: "Moussa recorded $850.00 from Awa Bah"});
    assert.deepEqual(copy(pay, "Moussa", "fr"),
        {title: "Paiement enregistré",
          body: "Moussa a enregistré $850.00 de Awa Bah"});
    assert.equal(copy({kind: "payment_recorded", amountCents: 5000}, "", "en")
        .body, "Someone recorded $50.00");
    assert.equal(copy({kind: "plate_added", plate: "X1"}, "", "fr").body,
        "Quelqu'un a ajouté la plaque X1");
  });

  it("bank matched: one run, count, total and first names", () => {
    const e = {kind: "bank_matched", count: 3, totalCents: 120000,
      names: ["Moussa", "Awa", "Kadi"]};
    assert.deepEqual(copy(e, "", "en"), {title: "Bank payments",
      body: "The bank recorded 3 payments, $1,200.00 in all: " +
        "Moussa, Awa and Kadi."});
    assert.deepEqual(copy(e, "", "fr"), {title: "Paiements de la banque",
      body: "La banque a enregistré 3 paiements, $1,200.00 au total : " +
        "Moussa, Awa et Kadi."});
    assert.equal(copy({...e, count: 6, names: ["A", "B", "C", "D", "E", "F"]},
        "", "en").body,
    "The bank recorded 6 payments, $1,200.00 in all: A, B, C and 3 more.");
    assert.equal(copy({kind: "bank_matched", count: 1, totalCents: 40000,
      names: ["Moussa"]}, "", "en").body,
    "The bank recorded $400.00 from Moussa.");
    assert.equal(copy({kind: "bank_matched", count: 1, totalCents: 40000,
      names: ["Moussa"]}, "", "fr").body,
    "La banque a enregistré $400.00 de Moussa.");
  });

  it("deposit waiting: one, and several in one run", () => {
    const one = {kind: "deposit_waiting", count: 1, amountCents: 40000,
      senderName: "Fatou Test", reason: "possible_duplicate"};
    assert.deepEqual(copy(one, "", "en"), {title: "A deposit needs you",
      body: "$400.00 from Fatou Test could not be given to a driver. " +
        "It may be a repeat of another deposit."});
    assert.deepEqual(copy(one, "", "fr"), {title: "Un dépôt vous attend",
      body: "$400.00 de Fatou Test n'a pas pu être attribué. " +
        "Il pourrait s'agir d'un doublon."});
    assert.equal(copy({...one, reason: "unknown"}, "", "en").body,
        "$400.00 from Fatou Test could not be given to a driver. " +
        "No driver matches the sender.");
    const many = {kind: "deposit_waiting", count: 3, totalCents: 90000};
    assert.deepEqual(copy(many, "", "en"), {title: "Deposits waiting",
      body: "3 deposits ($900.00) are waiting for you."});
    assert.deepEqual(copy(many, "", "fr"), {title: "Dépôts en attente",
      body: "3 dépôts ($900.00) vous attendent."});
  });

  it("claim needs the office", () => {
    const e = {kind: "claim_needs_office", driverName: "Awa Bah",
      amountCents: 40000, reason: "too_old"};
    assert.deepEqual(copy(e, "", "en"), {title: "A payment report needs you",
      body: "Awa Bah sent a payment report of $400.00. " +
        "The screenshot is too old."});
    assert.deepEqual(copy(e, "", "fr"), {title: "Un signalement vous attend",
      body: "Awa Bah a envoyé un signalement de paiement de $400.00. " +
        "La capture est trop ancienne."});
    assert.equal(copy({kind: "claim_needs_office"}, "", "en").body,
        "Someone sent a payment report.");
  });

  it("bank took back", () => {
    const e = {kind: "bank_took_back", count: 1, amountCents: 40000,
      names: ["Awa"]};
    assert.deepEqual(copy(e, "", "en"), {title: "The bank took back a deposit",
      body: "The bank removed a $400.00 deposit that had paid Awa. " +
        "Keep it or undo it."});
    assert.deepEqual(copy(e, "", "fr"), {title: "La banque a retiré un dépôt",
      body: "La banque a retiré un dépôt de $400.00 qui avait payé Awa. " +
        "Gardez-le ou annulez-le."});
    const many = {kind: "bank_took_back", count: 2, totalCents: 80000};
    assert.equal(copy(many, "", "en").body,
        "The bank removed 2 deposits that had paid drivers ($800.00). " +
        "Keep them or undo them.");
    assert.equal(copy(many, "", "fr").body,
        "La banque a retiré 2 dépôts qui avaient payé des chauffeurs " +
        "($800.00). Gardez-les ou annulez-les.");
  });

  it("summaries", () => {
    const s = (kind, n, lang) => fa.fleetSummaryCopy(kind, "Moussa", n, lang);
    assert.deepEqual(s("driver_added", 3, "en"),
        {title: "Drivers added", body: "Moussa added 3 more drivers"});
    assert.deepEqual(s("driver_added", 3, "fr"),
        {title: "Chauffeurs ajoutés",
          body: "Moussa a ajouté 3 chauffeurs de plus"});
    assert.equal(s("plate_added", 1, "en").body, "Moussa added 1 more plate");
    assert.equal(s("plate_added", 2, "fr").body,
        "Moussa a ajouté 2 plaques de plus");
    assert.equal(s("payment_recorded", 12, "en").body,
        "Moussa recorded 12 more payments");
    assert.equal(s("payment_recorded", 12, "fr").body,
        "Moussa a enregistré 12 paiements de plus");
  });

  it("money is US format", () => {
    assert.equal(fa.money(85000), "$850.00");
    assert.equal(fa.money(123456789), "$1,234,567.89");
    assert.equal(fa.money(5), "$0.05");
  });

  it("never carries the insurance policy number", () => {
    const event = {kind: "plate_added", businessId: "biz", carId: "c1",
      plate: "T123456C", policyNumber: "POLICY-SECRET-9", insurer: "Acme",
      actorUid: "admin"};
    const plan = fa.planFleetAlert({event, users: people, isBlocked});
    const everything = JSON.stringify(plan);
    assert.ok(!everything.includes("POLICY-SECRET-9"));
    assert.ok(!everything.includes("Acme"));
  });
});

describe("fleet alerts: the push data", () => {
  it("type, business, kind, tab and the ids that are known", () => {
    assert.deepEqual(fa.fleetAlertData({kind: "plate_added",
      businessId: "biz", carId: "c1", plate: "X"}),
    {type: "fleet_alert", businessId: "biz", fleetKind: "plate_added",
      fleetTab: "plates", carId: "c1"});
    assert.deepEqual(fa.fleetAlertData({kind: "driver_added",
      businessId: "biz", driverId: "d1"}),
    {type: "fleet_alert", businessId: "biz", fleetKind: "driver_added",
      fleetTab: "drivers", driverId: "d1"});
    assert.deepEqual(fa.fleetAlertData({kind: "payment_recorded",
      businessId: "biz", driverId: "d1", paymentId: "p1"}),
    {type: "fleet_alert", businessId: "biz", fleetKind: "payment_recorded",
      fleetTab: "drivers", driverId: "d1", paymentId: "p1"});
    assert.equal(fa.fleetAlertData({kind: "payment_recorded",
      businessId: "biz", paymentId: "p1"}).fleetTab, "payments");
    assert.equal(fa.fleetAlertData({kind: "bank_matched",
      businessId: "biz"}).fleetTab, "payments");
    for (const kind of ["deposit_waiting", "claim_needs_office",
      "bank_took_back"]) {
      assert.equal(fa.fleetAlertData({kind, businessId: "biz"}).fleetTab,
          "needs");
    }
  });

  it("every value is a string and no other field leaks", () => {
    const data = fa.fleetAlertData({kind: "claim_needs_office",
      businessId: "biz", driverId: "d1", amountCents: 500, reason: "x",
      policyNumber: "SECRET"});
    assert.deepEqual(Object.keys(data).sort(),
        ["businessId", "driverId", "fleetKind", "fleetTab", "type"]);
    for (const value of Object.values(data)) {
      assert.equal(typeof value, "string");
    }
  });
});

describe("fleet alerts: plans", () => {
  const event = (extra = {}) => ({kind: "driver_added", businessId: "biz",
    actorUid: "admin", driverId: "d1", driverName: "Awa Bah", ...extra});

  it("each recipient reads their own language; the actor's name is first",
      () => {
        const plan = fa.planFleetAlert({event: event(), users: people,
          isBlocked});
        assert.deepEqual(uids(plan.recipients), ["owner", "full"]);
        const byUid = Object.fromEntries(plan.recipients.map((r) =>
          [r.uid, r]));
        assert.equal(byUid.owner.language, "fr");
        assert.equal(byUid.owner.body, "Moussa a ajouté le chauffeur Awa Bah");
        assert.equal(byUid.full.body, "Moussa added driver Awa Bah");
        assert.equal(plan.data.driverId, "d1");
      });

  it("the actor not in the list is read from the profile given", () => {
    const plan = fa.planFleetAlert({event: event({actorUid: "ghost"}),
      users: people, actor: {id: "ghost", fullName: "Sekou Test"},
      isBlocked});
    assert.equal(plan.recipients.find((r) => r.uid === "full").body,
        "Sekou added driver Awa Bah");
  });

  it("a summary is the actor's count; ungrouped kinds have none", () => {
    const plan = fa.planFleetSummary({kind: "driver_added",
      businessId: "biz", users: people, actorUid: "admin", count: 3,
      isBlocked});
    assert.deepEqual(uids(plan.recipients), ["owner", "full"]);
    assert.equal(plan.recipients[1].body, "Moussa added 3 more drivers");
    assert.equal(plan.data.summary, "true");
    assert.equal(plan.data.count, "3");
    assert.equal(plan.data.fleetTab, "drivers");
    assert.equal(plan.data.driverId, undefined);
    assert.deepEqual(fa.planFleetSummary({kind: "deposit_waiting",
      businessId: "biz", users: people, count: 2}).recipients, []);
  });
});

describe("fleet alerts: grouping through the staff-activity window", () => {
  const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
  const MIN = 60 * 1000;

  it("the first event goes at once, the rest are held, the flush sums", () => {
    const first = sa.planWindowEvent(null, NOW);
    assert.equal(first.action, "send");
    const second = sa.planWindowEvent(first.next, NOW + MIN);
    const third = sa.planWindowEvent({...first.next, ...second.next},
        NOW + 2 * MIN);
    assert.equal(second.action, "hold");
    assert.equal(third.action, "hold");
    const state = {...first.next, ...second.next, ...third.next};
    assert.equal(state.pending, 2);
    const flush = sa.planWindowFlush(state, NOW + 11 * MIN);
    assert.deepEqual({flush: flush.flush, count: flush.count},
        {flush: true, count: 2});
  });

  it("windows and claims are per (business, kind, actor) and record", () => {
    assert.equal(sa.activityWindowId("biz", "driver_added", "admin"),
        "biz_driver_added_admin");
    assert.notEqual(sa.activityWindowId("biz", "plate_added", "admin"),
        sa.activityWindowId("biz", "driver_added", "admin"));
    assert.equal(sa.activityClaimId("plate_added", "c1"), "plate_added_c1");
  });

  it("a fleet window is never mistaken for a staff one", () => {
    for (const kind of fa.GROUPED_KINDS) {
      assert.ok(!sa.ACTIVITY_KINDS.includes(kind), kind);
      assert.ok(fa.isGroupedKind(kind));
    }
  });
});
