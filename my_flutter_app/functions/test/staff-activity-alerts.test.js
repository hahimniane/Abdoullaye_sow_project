"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const sa = require("../staff_activity_alerts");
const {
  normalizeNotificationPreferences,
  platformNotificationEnabled,
} = require("../notification_settings");

const NOW = Date.UTC(2026, 9, 22, 15, 0, 0);
const MIN = 60 * 1000;

const people = [
  {id: "owner", role: "businessOwner", businessId: "biz", fullName:
    "Abdoullaye Sow", preferredLanguage: "fr"},
  {id: "mamadou", role: "staff", businessId: "biz", fullName:
    "Mamadou Diallo", businessPermissions: ["parking"]},
  {id: "aissatou", role: "staff", businessId: "biz", fullName:
    "Aissatou Bah", businessPermissions: ["containers"]},
  {id: "driver", role: "staff", businessId: "biz", displayName: "Ousmane",
    businessPermissions: ["deliveries"], preferredLanguage: "fr"},
  {id: "cashier", role: "staff", businessId: "biz", fullName: "Kadi",
    businessPermissions: ["deliveries", "ledger"]},
  {id: "seller", role: "staff", businessId: "biz",
    businessPermissions: ["inventory"]},
  {id: "muted", role: "staff", businessId: "biz",
    businessPermissions: ["parking", "containers"],
    notificationPreferences: {parkedCarAlerts: false, packageAlerts: false}},
  {id: "blocked", role: "staff", businessId: "biz",
    businessPermissions: ["parking", "containers"],
    accountStatus: "suspended"},
  {id: "foreign", role: "staff", businessId: "other",
    businessPermissions: ["parking", "containers"]},
  {id: "foreign-owner", role: "businessOwner", businessId: "other"},
  {id: "customer", role: "customer", businessId: "biz"},
];

const isBlocked = (user) => user.accountStatus === "suspended";
const uids = (list) => list.map((entry) => entry.uid);
const recipients = (kind, extra = {}) => sa.planActivityRecipients({
  kind, businessId: "biz", users: people, actorUid: "mamadou", isBlocked,
  ...extra,
});

describe("staff activity: who hears", () => {
  it("a car reaches the owner and parking staff, owner first", () => {
    assert.deepEqual(uids(recipients("car", {actorUid: "aissatou"})),
        ["owner", "mamadou"]);
  });

  it("a package reaches the owner, containers and deliveries staff", () => {
    assert.deepEqual(uids(recipients("package", {actorUid: "nobody"})),
        ["owner", "aissatou", "cashier", "driver"]);
  });

  it("never tells the person who did it", () => {
    assert.ok(!uids(recipients("car")).includes("mamadou"));
    // The owner parking a car is not told either; parking staff are.
    assert.deepEqual(uids(recipients("car", {actorUid: "owner"})),
        ["mamadou"]);
  });

  it("skips staff without the area's permission and customers", () => {
    const car = uids(recipients("car", {actorUid: "x"}));
    for (const uid of ["aissatou", "driver", "cashier", "seller",
      "customer"]) {
      assert.ok(!car.includes(uid), uid);
    }
    const pkg = uids(recipients("package", {actorUid: "x"}));
    for (const uid of ["mamadou", "seller", "customer"]) {
      assert.ok(!pkg.includes(uid), uid);
    }
  });

  it("skips blocked accounts", () => {
    assert.ok(!uids(recipients("car")).includes("blocked"));
    assert.ok(uids(recipients("car", {isBlocked: () => false}))
        .includes("blocked"));
  });

  it("skips anyone who switched that alert off, and only that alert", () => {
    assert.ok(!uids(recipients("car")).includes("muted"));
    assert.ok(!uids(recipients("package")).includes("muted"));
    const carOnlyOff = people.map((p) => p.id === "aissatou" ?
      {...p, businessPermissions: ["parking", "containers"],
        notificationPreferences: {parkedCarAlerts: false}} : p);
    assert.ok(!uids(recipients("car", {users: carOnlyOff}))
        .includes("aissatou"));
    assert.ok(uids(recipients("package", {users: carOnlyOff}))
        .includes("aissatou"));
  });

  it("never reaches another business's people", () => {
    for (const kind of ["car", "package"]) {
      const out = uids(recipients(kind));
      assert.ok(!out.includes("foreign"));
      assert.ok(!out.includes("foreign-owner"));
    }
  });

  it("counts the business document's owner even without businessId", () => {
    const users = [...people, {id: "co-owner", role: "customer"}];
    assert.ok(uids(recipients("car", {users, ownerUids: ["co-owner"]}))
        .includes("co-owner"));
    assert.ok(!uids(recipients("car", {users})).includes("co-owner"));
  });

  it("caps the recipients, owners first", () => {
    const crowd = [...people];
    for (let i = 0; i < 80; i += 1) {
      crowd.push({id: `p${String(i).padStart(2, "0")}`, role: "staff",
        businessId: "biz", businessPermissions: ["parking"]});
    }
    const out = recipients("car", {users: crowd});
    assert.equal(out.length, sa.MAX_ACTIVITY_RECIPIENTS);
    assert.equal(out[0].uid, "owner");
  });

  it("a deliveries-only person never sees the price; others do", () => {
    const byUid = Object.fromEntries(recipients("package",
        {actorUid: "x"}).map((r) => [r.uid, r.seesMoney]));
    assert.deepEqual(byUid, {owner: true, aissatou: true, cashier: true,
      driver: false});
  });
});

describe("staff activity: which records alert", () => {
  const car = (extra = {}) => ({businessId: "biz", trackingCode: "PK-7Q2M",
    carYear: "2018", carMake: "Toyota", carModel: "Camry",
    createdAt: new Date(NOW - MIN), ...extra});

  it("names who parked it from the callable or the direct write", () => {
    assert.equal(sa.parkedCarActor(car({enteredByUid: "mamadou",
      enteredByBusiness: true, source: "business"})), "mamadou");
    assert.equal(sa.parkedCarActor(car({createdByUid: "mamadou"})),
        "mamadou");
    assert.deepEqual(sa.activityEventFor("car",
        car({enteredByUid: "mamadou"}), "pc1", NOW),
    {businessId: "biz", actorUid: "mamadou"});
  });

  it("skips a customer's online reservation", () => {
    const reservation = car({customerUid: "cust-1", status: "reserved"});
    assert.equal(sa.parkedCarActor(reservation), "");
    assert.deepEqual(sa.activityEventFor("car", reservation, "pc2", NOW),
        {skip: "no_actor"});
    // Even one that somehow carries a creator: it is the customer's.
    assert.equal(sa.parkedCarActor({...reservation,
      createdByUid: "cust-1"}), "");
  });

  it("skips a car whose creator cannot be named (an old app build)", () => {
    assert.deepEqual(sa.activityEventFor("car", car(), "pc3", NOW),
        {skip: "no_actor"});
  });

  it("skips copied, restored or undated records", () => {
    const old = car({enteredByUid: "mamadou",
      createdAt: new Date(NOW - 2 * 60 * MIN)});
    assert.deepEqual(sa.activityEventFor("car", old, "pc4", NOW),
        {skip: "stale"});
    assert.deepEqual(sa.activityEventFor("car",
        car({enteredByUid: "mamadou", createdAt: null}), "pc5", NOW),
    {skip: "stale"});
    // A Firestore Timestamp reads the same as a Date.
    const stamp = {toMillis: () => NOW - MIN};
    assert.equal(sa.activityEventFor("car",
        car({enteredByUid: "mamadou", createdAt: stamp}), "pc6", NOW)
        .actorUid, "mamadou");
  });

  it("skips a record with no business", () => {
    assert.deepEqual(sa.activityEventFor("car",
        car({businessId: "", enteredByUid: "m"}), "pc7", NOW),
    {skip: "no_business"});
  });

  const line = (extra = {}) => ({businessId: "biz", addedByStaffId:
    "aissatou", createdAt: new Date(NOW - MIN), ...extra});

  it("alerts for a root package, never for a split part", () => {
    assert.ok(sa.isNewPackage(line({rootLineId: "l1"}), "l1"));
    // A legacy line has no rootLineId at all: it is its own root.
    assert.ok(sa.isNewPackage(line(), "l1"));
    const part = line({rootLineId: "l1", splitFromLineId: "l1",
      partIndex: 2});
    assert.ok(!sa.isNewPackage(part, "l2"));
    assert.deepEqual(sa.activityEventFor("package", part, "l2", NOW),
        {skip: "not_new"});
    assert.ok(!sa.isNewPackage(line({rootLineId: "l1"}), "l9"));
    assert.deepEqual(sa.activityEventFor("package",
        line({rootLineId: "l1"}), "l1", NOW),
    {businessId: "biz", actorUid: "aissatou"});
  });

  it("skips a package with nobody named as its author", () => {
    assert.deepEqual(sa.activityEventFor("package",
        line({addedByStaffId: ""}), "l1", NOW), {skip: "no_actor"});
  });
});

describe("staff activity: what they read", () => {
  const camry = {trackingCode: "PK-7Q2M", carYear: "2018",
    carMake: "Toyota", carModel: "Camry"};

  it("writes the car alert in English and French", () => {
    assert.deepEqual(sa.carAlertCopy(camry, "Mamadou", "en"), {
      title: "Car parked",
      body: "Mamadou parked a 2018 Toyota Camry · PK-7Q2M"});
    assert.deepEqual(sa.carAlertCopy(camry, "Mamadou", "fr"), {
      title: "Voiture garée",
      body: "Mamadou a garé une Toyota Camry 2018 · PK-7Q2M"});
    assert.equal(sa.carAlertCopy({carMake: "Audi"}, "", "en").body,
        "Someone parked an Audi");
    assert.equal(sa.carAlertCopy({}, "", "fr").body,
        "Quelqu'un a garé une voiture");
  });

  const pkg = {customerName: "", receiverName: "Fatou Diallo",
    priceCents: 15000, containerId: "box1", trackingCode: "CL-1"};
  const box = {containerNumber: "MSKU1475304"};

  it("writes the package alert in English and French", () => {
    assert.deepEqual(sa.packageAlertCopy(pkg, box, "Aissatou", "en", true), {
      title: "Package saved",
      body: "Aissatou saved a package for Fatou Diallo · $150.00 · " +
        "MSKU1475304"});
    assert.deepEqual(sa.packageAlertCopy(pkg, box, "Aissatou", "fr", true), {
      title: "Colis enregistré",
      body: "Aissatou a enregistré un colis pour Fatou Diallo · $150.00 · " +
        "MSKU1475304"});
  });

  it("leaves the price out for someone who may not see it", () => {
    assert.equal(sa.packageAlertCopy(pkg, box, "Aissatou", "en", false).body,
        "Aissatou saved a package for Fatou Diallo · MSKU1475304");
  });

  it("says a waiting package is waiting for a container", () => {
    const waiting = {...pkg, containerId: ""};
    assert.equal(sa.packageAlertCopy(waiting, {}, "Aissatou", "en", true)
        .body, "Aissatou saved a package for Fatou Diallo · $150.00 · " +
        "waiting for a container");
    assert.equal(sa.packageAlertCopy(waiting, {}, "Aissatou", "fr", false)
        .body, "Aissatou a enregistré un colis pour Fatou Diallo · " +
        "en attente d'un conteneur");
  });

  it("names the sender before the receiver, and no one for stock", () => {
    assert.equal(sa.packageAlertCopy({...pkg, customerName: "Moussa"}, box,
        "A", "en", false).body, "A saved a package for Moussa · MSKU1475304");
    assert.equal(sa.packageAlertCopy({...pkg, ownerKind: "stock"}, box,
        "A", "en", false).body, "A saved a package · MSKU1475304");
  });

  it("writes the summaries in English and French", () => {
    assert.deepEqual(sa.activitySummaryCopy("package", "Aissatou", 12, "en"),
        {title: "Packages saved", body: "Aissatou saved 12 more packages"});
    assert.deepEqual(sa.activitySummaryCopy("package", "Aissatou", 12, "fr"),
        {title: "Colis enregistrés",
          body: "Aissatou a enregistré 12 colis de plus"});
    assert.deepEqual(sa.activitySummaryCopy("car", "Mamadou", 1, "en"),
        {title: "Cars parked", body: "Mamadou parked 1 more car"});
    assert.deepEqual(sa.activitySummaryCopy("car", "Mamadou", 3, "fr"),
        {title: "Voitures garées", body: "Mamadou a garé 3 voitures de plus"});
  });

  it("plans each reader's language and money, with a tap payload", () => {
    const plan = sa.planActivityAlert({kind: "package", businessId: "biz",
      record: {...pkg, businessId: "biz"}, recordId: "line1", users: people,
      actorUid: "aissatou", container: box, isBlocked});
    const byUid = Object.fromEntries(plan.recipients.map((r) => [r.uid, r]));
    assert.deepEqual(Object.keys(byUid), ["owner", "cashier", "driver"]);
    assert.match(byUid.owner.body, /^Aissatou a enregistré .*150\.00/);
    assert.equal(byUid.driver.language, "fr");
    assert.ok(!byUid.driver.body.includes("$"));
    assert.match(byUid.cashier.body, /^Aissatou saved .*\$150\.00/);
    assert.deepEqual(plan.data, {type: "container_line", businessId: "biz",
      lineId: "line1", containerId: "box1", trackingCode: "CL-1",
      relatedCollection: "containerLines", relatedId: "line1"});
  });

  it("plans a car alert with the parked car to open", () => {
    const plan = sa.planActivityAlert({kind: "car", businessId: "biz",
      record: camry, recordId: "pc1", users: people, actorUid: "mamadou",
      isBlocked});
    assert.deepEqual(uids(plan.recipients), ["owner"]);
    assert.equal(plan.recipients[0].body,
        "Mamadou a garé une Toyota Camry 2018 · PK-7Q2M");
    assert.equal(plan.data.type, "parked_car");
    assert.equal(plan.data.parkedCarId, "pc1");
    assert.equal(plan.data.relatedCollection, "parkedCars");
  });

  it("tells nobody when the actor is not one of the business's people",
      () => {
        for (const actorUid of ["foreign", "customer", "ghost"]) {
          const plan = sa.planActivityAlert({kind: "car", businessId: "biz",
            record: camry, recordId: "pc1", users: people, actorUid});
          assert.deepEqual(plan.recipients, [], actorUid);
        }
        // An actor read on their own (not among the users) still counts.
        const plan = sa.planActivityAlert({kind: "car", businessId: "biz",
          record: camry, recordId: "pc1", users: people, actorUid: "new",
          actor: {id: "new", role: "staff", businessId: "biz",
            fullName: "Binta Sow"}});
        assert.match(plan.recipients[0].body, /^Binta a garé/);
      });

  it("plans a summary that opens the list", () => {
    const plan = sa.planActivitySummary({kind: "package", businessId: "biz",
      users: people, actorUid: "aissatou", count: 12, isBlocked});
    assert.deepEqual(plan.data, {type: "container_line", businessId: "biz",
      summary: "true", count: "12"});
    const driver = plan.recipients.find((r) => r.uid === "driver");
    assert.equal(driver.body, "Aissatou a enregistré 12 colis de plus");
  });
});

describe("staff activity: grouping windows", () => {
  const W = sa.ACTIVITY_WINDOW_MS;

  it("sends the first event at once and opens a window", () => {
    const step = sa.planWindowEvent(null, NOW);
    assert.equal(step.action, "send");
    assert.equal(step.count, 1);
    assert.deepEqual(step.next, {windowStartMs: NOW, windowEndMs: NOW + W,
      pending: 0, flushDueMs: null, lastEventMs: NOW});
  });

  it("only counts further events inside the window", () => {
    let state = {...sa.planWindowEvent(null, NOW).next};
    for (let i = 1; i <= 3; i += 1) {
      const step = sa.planWindowEvent(state, NOW + i * MIN);
      assert.equal(step.action, "hold");
      state = {...state, ...step.next};
    }
    assert.equal(state.pending, 3);
    assert.equal(state.flushDueMs, NOW + W);
  });

  it("an event after an ended, unflushed window folds into one summary",
      () => {
        const state = {windowStartMs: NOW, windowEndMs: NOW + W, pending: 4,
          flushDueMs: NOW + W};
        const step = sa.planWindowEvent(state, NOW + W + MIN);
        assert.equal(step.action, "summary");
        assert.equal(step.count, 5);
        assert.equal(step.next.pending, 0);
        assert.equal(step.next.flushDueMs, null);
        assert.equal(step.next.windowEndMs, NOW + W + MIN + W);
      });

  it("an event after a flushed window starts over with a single alert",
      () => {
        const state = {windowEndMs: NOW + W, pending: 0, flushDueMs: null};
        assert.equal(sa.planWindowEvent(state, NOW + W).action, "send");
      });

  it("flushes an ended window with events waiting, then resets", () => {
    const state = {windowEndMs: NOW + W, pending: 12, flushDueMs: NOW + W};
    assert.deepEqual(sa.planWindowFlush(state, NOW + W + MIN),
        {flush: true, count: 12, next: {pending: 0, flushDueMs: null}});
    // Flushing the reset window again does nothing (two runs, one send).
    assert.deepEqual(sa.planWindowFlush({...state, pending: 0,
      flushDueMs: null}, NOW + W + 2 * MIN),
    {flush: false, count: 0, next: null});
  });

  it("leaves an open window alone", () => {
    const state = {windowEndMs: NOW + W, pending: 2, flushDueMs: NOW + W};
    assert.deepEqual(sa.planWindowFlush(state, NOW + MIN),
        {flush: false, count: 0, next: null});
  });

  it("drops a summary that is hours late instead of sending stale news",
      () => {
        const state = {windowEndMs: NOW, pending: 5, flushDueMs: NOW};
        assert.deepEqual(sa.planWindowFlush(state,
            NOW + sa.ACTIVITY_FLUSH_STALE_MS + MIN),
        {flush: false, count: 0, next: {pending: 0, flushDueMs: null}});
      });

  it("keys windows by business, kind and person, claims by record", () => {
    assert.equal(sa.activityWindowId("biz", "car", "mamadou"),
        "biz_car_mamadou");
    assert.equal(sa.activityClaimId("package", "line1"), "package_line1");
  });
});

describe("staff activity: preferences", () => {
  it("both alerts are on unless switched off, each on its own", () => {
    const defaults = normalizeNotificationPreferences(undefined);
    assert.equal(defaults.parkedCarAlerts, true);
    assert.equal(defaults.packageAlerts, true);
    const carOff = normalizeNotificationPreferences({parkedCarAlerts: false});
    assert.equal(carOff.parkedCarAlerts, false);
    assert.equal(carOff.packageAlerts, true);
    const pkgOff = normalizeNotificationPreferences({packageAlerts: false});
    assert.equal(pkgOff.packageAlerts, false);
    assert.equal(pkgOff.parkedCarAlerts, true);
  });

  it("no platform setting switches them off", () => {
    for (const key of Object.values(sa.ACTIVITY_PREFERENCE)) {
      assert.equal(platformNotificationEnabled({}, key), true);
    }
  });
});
