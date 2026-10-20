"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  COUNTRY_SENDS_PER_DAY,
  GLOBAL_SENDS_PER_DAY,
  MAX_CODE_ATTEMPTS,
  phoneSignInAllowed,
  proofAcceptable,
  trackingLimitKey,
  PHONE_RECORD_SOURCES,
  codeAttempt,
  codeHash,
  hiddenDocId,
  isPlaceholderAccount,
  limitDecision,
  loginSendLimits,
  mergeShipmentPage,
  needsRegion,
  newLoginCode,
  notSignedInYet,
  packageRequestPublicRecord,
  parseCursor,
  parseRecordKey,
  privateShipmentItem,
  recordPhonePatch,
  recordPhones,
  shipmentQueries,
  RECENT_RECORD_MS,
  createPhoneAccounts,
  phoneEventNeedsSync,
  stampIsCurrent,
} = require("../phone_accounts");
const {signInHints} = require("../guest_tracking");
const {addressBucket} = require("../request_guard");

describe("record phones", () => {
  it("knows sender and receiver fields of every source", () => {
    assert.deepEqual(Object.keys(PHONE_RECORD_SOURCES).sort(), [
      "barrelShipments", "containerLines", "freightQuoteRequests",
      "freightShipments", "packageRequests", "parkedCars",
      "transportRequests"]);
    const phones = recordPhones("containerLines", {
      customerPhone: "+1 202 555 0123", customerName: "Fatou",
      receiverPhone: "+224 622 12 34 56", receiverName: "Mamadou"});
    assert.deepEqual(phones.map((p) => [p.role, p.e164, p.name]), [
      ["sender", "+12025550123", "Fatou"],
      ["receiver", "+224622123456", "Mamadou"]]);
  });

  it("reads package requests' nested, already-E.164 numbers", () => {
    const phones = recordPhones("packageRequests", {
      sender: {name: "Awa", phoneE164: "+12025550123"},
      receiver: {name: "Ibrahima", phoneE164: "622123456"}});
    assert.deepEqual(phones.map((p) => [p.role, p.e164, p.status]), [
      ["sender", "+12025550123", "ok"], ["receiver", "", "invalid"]]);
  });

  it("asks for the business's country only for a local number", () => {
    assert.equal(needsRegion("containerLines",
        {customerPhone: "+12025550123"}), false);
    assert.equal(needsRegion("containerLines",
        {customerPhone: "2025550123"}), true);
    assert.equal(needsRegion("packageRequests",
        {sender: {phoneE164: "2025550123"}}), false);
  });
});

describe("recordPhonePatch", () => {
  it("stamps E.164 fields and converges on its own output", () => {
    const data = {customerPhone: "(202) 555-0123",
      receiverPhone: "+224622123456"};
    const first = recordPhonePatch("containerLines", data, "US");
    assert.deepEqual(first.changes, {customerPhoneE164: "+12025550123",
      receiverPhoneE164: "+224622123456"});
    assert.deepEqual(first.newNumbers.map((p) => p.e164),
        ["+12025550123", "+224622123456"]);
    const again = recordPhonePatch("containerLines",
        {...data, ...first.changes}, "US");
    assert.deepEqual(again, {changes: {}, newNumbers: []});
  });

  it("flags a local number it cannot place, and creates no account", () => {
    const data = {customerPhone: "622123456", receiverPhone: ""};
    const patch = recordPhonePatch("containerLines", data, "US");
    assert.deepEqual(patch.changes,
        {phoneCountryCodeMissing: ["customerPhone"]});
    assert.deepEqual(patch.newNumbers, []);
    // Staff add the code: the flag goes, the number gets its account.
    const fixed = recordPhonePatch("containerLines", {...data,
      ...patch.changes, customerPhone: "+224622123456"}, "US");
    assert.deepEqual(fixed.changes, {customerPhoneE164: "+224622123456",
      phoneCountryCodeMissing: null});
    assert.equal(fixed.newNumbers.length, 1);
  });

  it("moves the record when staff change the number", () => {
    const stored = {customerPhone: "+12025550199",
      customerPhoneE164: "+12025550123",
      phoneReportedNotMine: ["customerPhone"]};
    const patch = recordPhonePatch("barrelShipments", stored, "");
    assert.deepEqual(patch.changes, {customerPhoneE164: "+12025550199",
      phoneReportedNotMine: null});
    assert.deepEqual(patch.newNumbers.map((p) => p.e164), ["+12025550199"]);
  });

  it("removes the derived field when the number is cleared", () => {
    const patch = recordPhonePatch("parkedCars",
        {customerPhone: "", customerPhoneE164: "+12025550123"}, "");
    assert.deepEqual(patch.changes, {customerPhoneE164: null});
    assert.deepEqual(patch.newNumbers, []);
  });

  it("never stamps package requests", () => {
    assert.deepEqual(recordPhonePatch("packageRequests",
        {sender: {phoneE164: "+12025550123"}}, "").changes, {});
  });
});

describe("login codes", () => {
  it("makes six-digit codes", () => {
    for (let i = 0; i < 50; i++) assert.match(newLoginCode(), /^\d{6}$/);
  });

  const challenge = (extra = {}) => ({codeHash: codeHash("c1", "123456"),
    expiresAtMs: 10000, attempts: 0, status: "open", ...extra});

  it("accepts the right code once", () => {
    const right = codeAttempt(challenge(), "123 456", "c1", 5000);
    assert.equal(right.outcome, "ok");
    assert.equal(right.update.status, "used");
    assert.equal(codeAttempt(challenge({status: "used"}), "123456", "c1",
        5000).outcome, "challenge_not_found");
  });

  it("locks after five wrong codes, even with the right one after", () => {
    let stored = challenge();
    const outcomes = [];
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const result = codeAttempt(stored, "000000", "c1", 5000);
      outcomes.push([result.outcome, result.attemptsLeft]);
      stored = {...stored, ...result.update};
    }
    assert.deepEqual(outcomes, [["code_wrong", 4], ["code_wrong", 3],
      ["code_wrong", 2], ["code_wrong", 1], ["too_many_attempts", 0]]);
    assert.equal(stored.status, "locked");
    assert.equal(codeAttempt(stored, "123456", "c1", 5000).outcome,
        "too_many_attempts");
  });

  it("refuses an expired code without counting it", () => {
    const late = codeAttempt(challenge(), "123456", "c1", 10001);
    assert.equal(late.outcome, "code_expired");
    assert.equal(late.update, null);
  });

  it("binds the hash to its challenge", () => {
    assert.notEqual(codeHash("c1", "123456"), codeHash("c2", "123456"));
    assert.equal(codeAttempt(challenge(), "123456", "c2", 5000).outcome,
        "code_wrong");
  });

  it("limits sends per number, hour and day, plus the resend gap", () => {
    const [hour, day] = loginSendLimits({phone: "+1", ip: "", trackingCode:
      ""});
    let stored = null;
    let now = 1000000;
    for (let i = 0; i < 5; i++) {
      const result = limitDecision(stored, hour, now, 30000);
      assert.equal(result.allowed, true, `send ${i + 1}`);
      stored = result.next;
      now += 31000;
    }
    const sixth = limitDecision(stored, hour, now, 30000);
    assert.equal(sixth.allowed, false);
    assert.ok(sixth.retryAfterMs > 0);
    // A new hour opens the window again.
    assert.equal(limitDecision(stored, hour, 1000000 + 3600001, 30000)
        .allowed, true);
    // Too soon after the last one.
    const soon = limitDecision({count: 1, windowStartMs: now, lastAtMs: now},
        hour, now + 5000, 30000);
    assert.deepEqual([soon.allowed, soon.retryAfterMs], [false, 25000]);
    assert.equal(day.limit, 10);
    assert.deepEqual(loginSendLimits({phone: "+1", ip: "1.2.3.4",
      trackingCode: "CL-1", callingCode: "224"}).map((l) =>
      [l.kind, l.key, l.limit]), [
      ["phone_hour", "+1", 5], ["phone_day", "+1", 10],
      ["ip_hour", "1.2.3.4", 20], ["tracking_hour", "CL1", 5],
      ["country_day", "224", COUNTRY_SENDS_PER_DAY],
      ["global_day", "all", GLOBAL_SENDS_PER_DAY]]);
  });
});

describe("My packages", () => {
  const row = (key, ms, extra = {}) => ({key, collection: key.split("/")[0],
    id: key.split("/")[1], role: "sender", raw: "customerPhone",
    data: {customerPhone: "+12025550123"}, createdAtMs: ms, ...extra});
  const E = "+12025550123";

  it("runs one bounded query per collection and role", () => {
    const queries = shipmentQueries();
    assert.equal(queries.length, 11);
    assert.ok(queries.some((q) => q.collection === "packageRequests" &&
      q.field === "receiver.phoneE164"));
    assert.ok(queries.every((q) => q.field));
  });

  it("merges newest first and pages without losing equal times", () => {
    const candidates = [row("containerLines/a", 300),
      row("barrelShipments/b", 200), row("parkedCars/c", 200),
      row("containerLines/d", 100)];
    const first = mergeShipmentPage(candidates, {e164: E, pageSize: 2,
      hidden: new Set()});
    assert.deepEqual(first.rows.map((r) => r.key),
        ["containerLines/a", "barrelShipments/b"]);
    assert.deepEqual(first.nextCursor,
        {beforeMs: 200, skipKeys: ["barrelShipments/b"]});
    // The next page re-reads createdAt <= 200 and skips what it showed.
    const second = mergeShipmentPage(candidates.slice(1), {e164: E,
      pageSize: 2, hidden: new Set(), cursor: first.nextCursor});
    assert.deepEqual(second.rows.map((r) => r.key),
        ["parkedCars/c", "containerLines/d"]);
    assert.equal(second.nextCursor, null);
  });

  it("drops records whose number changed, hidden ones, received requests",
      () => {
        const rows = mergeShipmentPage([
          row("containerLines/moved", 5,
              {data: {customerPhone: "+12025550199"}}),
          row("containerLines/hidden", 4),
          row("packageRequests/got", 3, {raw: "sender.phoneE164",
            data: {sender: {phoneE164: E}, status: "received"}}),
          row("packageRequests/open", 2, {raw: "sender.phoneE164",
            data: {sender: {phoneE164: E}, status: "estimate_sent"}}),
        ], {e164: E, hidden: new Set(["containerLines/hidden"])}).rows;
        assert.deepEqual(rows.map((r) => r.key), ["packageRequests/open"]);
      });

  it("lists a package sent to oneself once, as the sender's", () => {
    const rows = mergeShipmentPage([
      row("containerLines/x", 1, {role: "receiver", raw: "receiverPhone",
        data: {customerPhone: E, receiverPhone: E}}),
      row("containerLines/x", 1, {data: {customerPhone: E,
        receiverPhone: E}}),
    ], {e164: E}).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "sender");
    assert.deepEqual(rows[0].roles.sort(), ["receiver", "sender"]);
  });

  it("shows what WhatsApp shows, without any money", () => {
    const item = privateShipmentItem({
      trackingCode: "CL-1", service: "container", stage: "in_transit",
      pieceCount: 2, signIn: [{role: "sender", lastTwo: "23"}],
      parts: [{trackingCode: "CL-1", stage: "in_transit", pieceCount: 2,
        priceCents: 5000}],
      payment: {priceCents: 5000, paidCents: 0, balanceCents: 5000},
      shipping: {shippingLine: "Maersk"}, updatedAtMs: 9,
    }, {key: "containerLines/l1", collection: "containerLines",
      role: "sender", roles: ["sender"], createdAtMs: 8,
      data: {businessId: "biz", priceCents: 5000, customerName: "Fatou"}},
    "Dala Shipping");
    assert.deepEqual(item, {
      key: "containerLines/l1", collection: "containerLines",
      role: "sender", roles: ["sender"], businessId: "biz",
      businessName: "Dala Shipping", trackingCode: "CL-1",
      service: "container", stage: "in_transit", pieceCount: 2,
      parts: [{trackingCode: "CL-1", stage: "in_transit", pieceCount: 2}],
      shipping: {shippingLine: "Maersk"}, updatedAtMs: 9, createdAtMs: 8,
    });
    assert.doesNotMatch(JSON.stringify(item), /5000|price|Fatou|payment/i);
  });

  it("projects a package request without its prices or contents", () => {
    const record = packageRequestPublicRecord({code: "R-48KQ2",
      status: "estimate_sent", pieces: [{description: "Rice",
        estimateCents: 9000}, {description: "Shoes"}],
      estimate: {totalCents: 9000}}, "r1");
    assert.deepEqual(record, {trackingCode: "R-48KQ2",
      service: "package_request", stage: "requested",
      requestStatus: "estimate_sent", pieceCount: 2, updatedAtMs: 0});
  });

  it("parses cursors and keys defensively", () => {
    assert.equal(parseCursor(null), null);
    assert.equal(parseCursor({beforeMs: "x"}), null);
    assert.deepEqual(parseCursor({beforeMs: 5.7, skipKeys: ["a/b", 3]}),
        {beforeMs: 5, skipKeys: ["a/b", "3"]});
    assert.deepEqual(parseRecordKey("containerLines/abc_1"),
        {collection: "containerLines", id: "abc_1"});
    assert.equal(parseRecordKey("users/abc"), null);
    assert.equal(parseRecordKey("containerLines/a/b"), null);
    assert.equal(hiddenDocId("containerLines/abc"), "containerLines__abc");
  });
});

describe("placeholders", () => {
  const profile = {accountOrigin: "shipment", firstSignInAt: null};
  it("only a never-signed-in, phone-only record account may be merged",
      () => {
        assert.equal(isPlaceholderAccount(profile,
            {providerData: [{providerId: "phone"}]}), true);
        assert.equal(isPlaceholderAccount(profile, {providerData: []}), true);
        assert.equal(isPlaceholderAccount({...profile, firstSignInAt: 1},
            {providerData: []}), false);
        assert.equal(isPlaceholderAccount({accountOrigin: "phone_sign_in"},
            {providerData: []}), false);
        assert.equal(isPlaceholderAccount(profile, {email: "a@b.co"}), false);
        assert.equal(isPlaceholderAccount(profile,
            {providerData: [{providerId: "password"}]}), false);
        assert.equal(isPlaceholderAccount(null, {}), false);
      });
  it("labels not-signed-in accounts", () => {
    assert.equal(notSignedInYet(profile), true);
    assert.equal(notSignedInYet({...profile, firstSignInAt: {}}), false);
    assert.equal(notSignedInYet({role: "customer"}), false);
  });
});

describe("tracking page sign-in hints", () => {
  it("shows two digits per number, none for a local one", () => {
    assert.deepEqual(signInHints({customerPhone: "+12025550135",
      receiverPhoneE164: "+224622123412"}), [
      {role: "sender", lastTwo: "35"}, {role: "receiver", lastTwo: "12"}]);
    assert.deepEqual(signInHints({customerPhone: "2025550135"}), []);
    assert.deepEqual(signInHints({customerPhone: "+12025550135",
      receiverPhone: "+1 202 555 0135"}), [{role: "sender", lastTwo: "35"}]);
  });
});

// Review fixes (2026-10): cost abuse, customer-only, merge proof.
describe("send limits cannot be dodged", () => {
  it("counts every spelling of a tracking code as one", () => {
    for (const spelling of ["CL-K7M4P2", "cl-k7m4p2", " cl k7m 4p2 ",
      "CL/K7M4P2"]) {
      assert.equal(trackingLimitKey(spelling), "CLK7M4P2", spelling);
    }
    assert.equal(trackingLimitKey(""), "");
  });
  it("counts an IPv6 caller by its /64, an IPv4 caller by its address",
      () => {
        assert.equal(addressBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"),
            "2001:db8:1:2::/64");
        assert.equal(addressBucket("2001:db8:1:2::ffff"),
            "2001:db8:1:2::/64");
        assert.equal(addressBucket("[2001:0db8:0001:0002::5]:443"),
            "2001:db8:1:2::/64");
        assert.notEqual(addressBucket("2001:db8:1:3::1"),
            addressBucket("2001:db8:1:2::1"));
        assert.equal(addressBucket("203.0.113.9"), "203.0.113.9");
        assert.equal(addressBucket("::ffff:203.0.113.9"), "203.0.113.9");
        assert.equal(addressBucket("unknown"), "");
        assert.equal(addressBucket(""), "");
      });
  it("caps the platform and each calling code per day", () => {
    const limits = loginSendLimits({phone: "+224622123456", ip: "",
      trackingCode: "", callingCode: "224"});
    const global = limits.find((l) => l.kind === "global_day");
    const country = limits.find((l) => l.kind === "country_day");
    assert.equal(global.windowMs, 24 * 60 * 60 * 1000);
    assert.equal(country.key, "224");
    const full = {count: GLOBAL_SENDS_PER_DAY, windowStartMs: 1000,
      lastAtMs: 1000};
    assert.equal(limitDecision(full, global, 2000).allowed, false);
  });
});

describe("phone sign-in is for customers only", () => {
  it("lets customers and new numbers in, nobody with business or " +
      "platform access", () => {
    assert.equal(phoneSignInAllowed(null), true);
    assert.equal(phoneSignInAllowed({role: "customer"}), true);
    assert.equal(phoneSignInAllowed({}), true);
    for (const profile of [{role: "staff", businessId: "b"},
      {role: "businessOwner"}, {role: "admin"},
      {role: "customer", platformAdmin: true},
      {role: "customer", adminRole: "supportAdmin"},
      {role: "customer", businessId: "b"},
      {role: "customer", businessPermissions: ["containers"]}]) {
      assert.equal(phoneSignInAllowed(profile), false,
          JSON.stringify(profile));
    }
  });
});

describe("merge proof", () => {
  const now = 1700000000000;
  const good = {uid: "holder", phone_number: "+12025550123",
    auth_time: now / 1000 - 60, firebase: {sign_in_provider: "phone"}};
  const expected = {e164: "+12025550123", holderUid: "holder", nowMs: now};
  it("accepts a fresh phone sign-in of that number by its holder", () => {
    assert.equal(proofAcceptable(good, expected), true);
  });
  it("refuses a stale, foreign or different-number proof", () => {
    assert.equal(proofAcceptable({...good, auth_time: now / 1000 - 301},
        expected), false);
    assert.equal(proofAcceptable({...good, uid: "someone"}, expected),
        false);
    assert.equal(proofAcceptable(good, {...expected, holderUid: ""}), false);
    assert.equal(proofAcceptable({...good, phone_number: "+12025550199"},
        expected), false);
    assert.equal(proofAcceptable({...good,
      firebase: {sign_in_provider: "password"}}, expected), false);
    assert.equal(proofAcceptable({...good, auth_time: undefined}, expected),
        false);
    assert.equal(proofAcceptable(null, expected), false);
  });
});

// 2026-10 incident: a burst of updates to old, unstamped records exhausted
// the 20-vCPU quota. The trigger's first question must cost nothing.
describe("trigger pre-checks (no reads)", () => {
  const stampedLine = {customerPhone: "+1 202 555 0123",
    customerPhoneE164: "+12025550123", receiverPhone: "+224622123456",
    receiverPhoneE164: "+224622123456"};

  it("a stamp that matches the raw numbers is current", () => {
    assert.equal(stampIsCurrent("containerLines", stampedLine, null), true);
    assert.equal(stampIsCurrent("containerLines", stampedLine, undefined),
        true);
    assert.equal(stampIsCurrent("packageRequests", {}, null), true);
    assert.equal(stampIsCurrent("parkedCars", {customerPhone: ""}, null),
        true);
  });

  it("a changed, missing or stale stamp is not", () => {
    assert.equal(stampIsCurrent("containerLines",
        {...stampedLine, receiverPhone: "+224622999999"}, null), false);
    assert.equal(stampIsCurrent("parkedCars",
        {customerPhone: "+12025550123"}, null), false);
    assert.equal(stampIsCurrent("parkedCars",
        {customerPhone: "", customerPhoneE164: "+12025550123"}, null), false);
    assert.equal(stampIsCurrent("parkedCars", {customerPhone: "+12025550123",
      customerPhoneE164: "+12025550123",
      phoneCountryCodeMissing: ["customerPhone"]}, null), false);
  });

  it("judges a local number only when this write left it alone", () => {
    const flagged = {customerPhone: "622 12 34 56",
      phoneCountryCodeMissing: ["customerPhone"]};
    // Its own stamp re-fired the trigger: same raw number, flag in place.
    assert.equal(stampIsCurrent("parkedCars", flagged,
        {customerPhone: "622 12 34 56"}), true);
    // Created, or the number was edited: only the business can tell.
    assert.equal(stampIsCurrent("parkedCars", flagged, null), false);
    assert.equal(stampIsCurrent("parkedCars", {...flagged,
      customerPhone: "202 555 0123"}, {customerPhone: "622 12 34 56"}), false);
    // A US business's ten digits, stamped +1.
    const nanp = {customerPhone: "(202) 555-0123",
      customerPhoneE164: "+12025550123"};
    assert.equal(stampIsCurrent("parkedCars", nanp,
        {customerPhone: "(202) 555-0123"}), true);
    assert.equal(stampIsCurrent("parkedCars", {...nanp,
      customerPhoneE164: "+12025550199"},
    {customerPhone: "(202) 555-0123"}), false);
    // Unflagged and unstamped: never synced.
    assert.equal(stampIsCurrent("parkedCars", {customerPhone: "622123456"},
        {customerPhone: "622123456"}), false);
  });

  it("leaves old, never-synced records whose numbers did not change to " +
      "the backfill", () => {
    const now = Date.UTC(2026, 9, 19);
    const old = {customerPhone: "+12025550123", status: "picked_up",
      createdAt: new Date(now - 90 * 24 * 3600 * 1000)};
    const prior = {...old, status: "parked"};
    assert.equal(phoneEventNeedsSync("parkedCars", old, prior, now), false);
    // ...but a missing createdAt is old too.
    assert.equal(phoneEventNeedsSync("parkedCars",
        {customerPhone: "+12025550123"}, {customerPhone: "+12025550123"},
        now), false);
    // The contract's "at once": new records and number changes.
    assert.equal(phoneEventNeedsSync("parkedCars", old, null, now), true);
    assert.equal(phoneEventNeedsSync("parkedCars", old, undefined, now),
        true);
    assert.equal(phoneEventNeedsSync("parkedCars", old,
        {...prior, customerPhone: "+12025550199"}, now), true);
    assert.equal(phoneEventNeedsSync("containerLines",
        {...old, receiverPhone: "+224622123456"}, prior, now), true);
    // Recent records (a client's direct create, a failed account).
    const fresh = {...old, createdAt: new Date(now - RECENT_RECORD_MS + 1000)};
    assert.equal(phoneEventNeedsSync("parkedCars", fresh,
        {...fresh, status: "parked"}, now), true);
    // A record synced before whose stamp went stale (account failed).
    assert.equal(phoneEventNeedsSync("parkedCars",
        {...old, phoneSyncedAt: new Date(now)}, prior, now), true);
    assert.equal(phoneEventNeedsSync("parkedCars",
        {...old, phoneCountryCodeMissing: []}, prior, now), true);
  });

  it("returns before any Firestore or Auth call when nothing is to do",
      async () => {
        const touched = [];
        const trap = (name) => new Proxy({}, {get(_, key) {
          touched.push(`${name}.${String(key)}`);
          throw new Error(`${name} touched`);
        }});
        const accounts = createPhoneAccounts({db: () => trap("db"),
          auth: () => trap("auth"), FieldValue: {}, Timestamp: {},
          logger: {warn: (message, meta) => touched.push(meta?.error)},
          defaultNotificationPreferences: () => ({})});
        const now = Date.now();
        // A stamp re-fired by its own write.
        assert.deepEqual(await accounts.syncRecordPhones("containerLines",
            "l1", {after: stampedLine, before: {}, updateTime: "t"}),
        {written: false, accounts: []});
        // An old record's status change.
        const old = {customerPhone: "+12025550123",
          createdAt: new Date(now - 90 * 24 * 3600 * 1000)};
        assert.deepEqual(await accounts.syncRecordPhones("parkedCars", "p1",
            {after: old, before: {...old, status: "x"}, updateTime: "t"}),
        {written: false, accounts: []});
        assert.deepEqual(await accounts.phoneStampForEvent("parkedCars", "p1",
            {after: old, before: {...old, status: "x"}}),
        {update: null, accounts: []});
        // A deleted record.
        assert.deepEqual(await accounts.syncRecordPhones("parkedCars", "p1",
            {after: null}), {written: false, accounts: []});
        assert.deepEqual(touched, []);
      });
});
