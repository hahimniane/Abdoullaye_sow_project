"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  MAX_CODE_ATTEMPTS,
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
} = require("../phone_accounts");
const {signInHints} = require("../guest_tracking");

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
      trackingCode: "CL-1"}).map((l) => [l.kind, l.limit]), [
      ["phone_hour", 5], ["phone_day", 10], ["ip_hour", 20],
      ["tracking_hour", 5]]);
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
