"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const z = require("../zelle_check");

const MIN = 60 * 1000;
const AT = Date.parse("2026-10-16T18:00:00Z");
const ctx = (over = {}) => ({amountCents: 4000, atMs: AT, windowMinutes: 15,
  accountId: "acc", timeZone: "America/New_York", ...over});
const credit = (over = {}) => ({id: "biz_t1", businessId: "biz",
  transactionId: "t1", accountId: "acc", amountCents: 4000, pending: false,
  atMs: AT + 2 * MIN, timeKnown: true, dateKey: "2026-10-16",
  senderName: "FATOU BAH", ...over});

describe("zelle check: which deposits can be this payment", () => {
  it("needs exactly the payment's amount", () => {
    assert.equal(z.creditIneligibility(credit(), ctx()), null);
    assert.equal(z.creditIneligibility(credit({amountCents: 4001}), ctx()),
        "amount");
    assert.equal(z.creditIneligibility(credit({amountCents: 3999}), ctx()),
        "amount");
  });

  it("counts the window on both sides, edges included", () => {
    for (const offset of [-15, -1, 0, 1, 15]) {
      assert.equal(z.creditIneligibility(credit({atMs: AT + offset * MIN}),
          ctx()), null, `${offset} min`);
    }
    for (const offset of [-16, 16, -60 * 24]) {
      assert.equal(z.creditIneligibility(credit({atMs: AT + offset * MIN}),
          ctx()), "outside_window", `${offset} min`);
    }
    assert.equal(z.creditIneligibility(credit({atMs: AT + 45 * MIN}),
        ctx({windowMinutes: 60})), null);
  });

  it("leaves out used, removed and other-account deposits", () => {
    assert.equal(z.creditIneligibility(credit({consumedBy: {
      kind: "inventory_sale", id: "s9"}}), ctx()), "consumed");
    assert.equal(z.creditIneligibility(credit({removed: true}), ctx()),
        "removed");
    assert.equal(z.creditIneligibility(credit({accountId: "old"}), ctx()),
        "other_account");
    // Absent consumedBy (never written by a sync) is free; null too.
    assert.equal(z.creditIneligibility(credit({consumedBy: null}), ctx()),
        null);
  });

  it("lets a payment re-see the deposit it already holds", () => {
    const mine = {kind: "inventory_sale", id: "s1"};
    assert.equal(z.creditIneligibility(credit({consumedBy: mine}),
        ctx({consumedByMe: mine})), null);
    assert.equal(z.creditIneligibility(credit({consumedBy: mine}),
        ctx({consumedByMe: {kind: "inventory_sale", id: "s2"}})), "consumed");
  });

  it("counts pending deposits", () => {
    assert.equal(z.creditIneligibility(credit({pending: true}), ctx()), null);
  });

  it("holds a date-only deposit to the window's dates in the zone", () => {
    const dated = credit({atMs: null, timeKnown: false});
    assert.equal(z.creditIneligibility(dated, ctx()), null);
    assert.equal(z.creditIneligibility({...dated, dateKey: "2026-10-15"},
        ctx()), "outside_window");
    // 03:55 UTC on the 17th is 23:55 on the 16th in New York.
    const late = Date.parse("2026-10-17T03:55:00Z");
    assert.equal(z.creditIneligibility(dated, ctx({atMs: late})), null);
    assert.equal(z.creditIneligibility({...dated, dateKey: "2026-10-17"},
        ctx({atMs: late})), null, "the window crosses midnight");
  });
});

describe("zelle check: the outcome", () => {
  it("one timed deposit confirms", () => {
    const out = z.zelleOutcome(z.zelleCandidates(ctx(), [credit()]));
    assert.equal(out.result, "confirmed");
    assert.equal(out.credit.id, "biz_t1");
  });

  it("several same-amount deposits are for staff to choose, closest first",
      () => {
        const out = z.zelleOutcome(z.zelleCandidates(ctx(), [
          credit({id: "far", atMs: AT + 12 * MIN, senderName: "A"}),
          credit({id: "near", atMs: AT - MIN, senderName: "B"}),
          credit({id: "used", consumedBy: {kind: "x", id: "y"}}),
        ]));
        assert.equal(out.result, "choose");
        assert.deepEqual(out.candidates.map((c) => c.id), ["near", "far"]);
        assert.deepEqual(z.candidateView(out.candidates[0]), {creditId: "near",
          atMs: AT - MIN, timeKnown: true, senderName: "B", pending: false});
      });

  it("a date-only deposit is never confirmed on its own", () => {
    const out = z.zelleOutcome(z.zelleCandidates(ctx(),
        [credit({atMs: null, timeKnown: false})]));
    assert.equal(out.result, "choose");
    const view = z.candidateView(out.candidates[0]);
    assert.equal(view.timeKnown, false);
    assert.equal(view.atMs, Date.parse("2026-10-16T12:00:00Z"));
  });

  it("nothing eligible is not found", () => {
    assert.deepEqual(z.zelleOutcome(z.zelleCandidates(ctx(), [
      credit({amountCents: 1}), credit({removed: true}),
      credit({atMs: AT + 30 * MIN})])), {result: "not_found"});
    assert.deepEqual(z.zelleOutcome([]), {result: "not_found"});
  });

  it("writes the confirmation staff see, and nothing more", () => {
    const check = z.confirmedBankCheck({credit: credit(),
      institutionName: "Chase", uid: "u1"});
    assert.deepEqual(check, {status: "confirmed", creditId: "biz_t1",
      amountCents: 4000, atMs: AT + 2 * MIN, timeKnown: true,
      senderName: "FATOU BAH", institutionName: "Chase", checkedByUid: "u1"});
    assert.deepEqual(z.confirmationFromBankCheck(check), {amountCents: 4000,
      atMs: AT + 2 * MIN, timeKnown: true, senderName: "FATOU BAH",
      institutionName: "Chase"});
    assert.equal(z.confirmationFromBankCheck({status: "not_found"}), null);
  });
});

describe("zelle check: the payment a record holds", () => {
  const ts = {toMillis: () => AT};
  it("reads a sale's paid-now part (old sales: the total)", () => {
    assert.deepEqual(z.paymentOfRecord("inventory_sale", {paidNowCents: 1500,
      totalCents: 4000, paymentMethod: "zelle", createdAt: ts}),
    {amountCents: 1500, method: "zelle", atMs: AT, voided: false,
      bankCheck: null});
    assert.equal(z.paymentOfRecord("inventory_sale", {totalCents: 4000,
      paymentMethod: "zelle"}).amountCents, 4000);
  });

  it("reads credit and package payments", () => {
    for (const kind of ["inventory_credit_payment",
      "container_line_payment"]) {
      assert.deepEqual(z.paymentOfRecord(kind, {amountCents: 2500,
        method: "zelle", createdAt: ts, reverted: true}),
      {amountCents: 2500, method: "zelle", atMs: AT, voided: true,
        bankCheck: null});
    }
  });

  it("refuses what is not a live Zelle payment of this business", () => {
    const sale = {businessId: "biz", paymentMethod: "zelle",
      paidNowCents: 100};
    assert.equal(z.checkRecordRefusal("inventory_sale", sale, "biz"), null);
    assert.equal(z.checkRecordRefusal("inventory_sale", null, "biz"),
        "record_not_found");
    assert.equal(z.checkRecordRefusal("inventory_sale", sale, "other"),
        "record_not_found");
    assert.equal(z.checkRecordRefusal("inventory_sale", {...sale,
      voided: true}, "biz"), "record_voided");
    assert.equal(z.checkRecordRefusal("inventory_sale", {...sale,
      paymentMethod: "cash"}, "biz"), "not_zelle");
    assert.equal(z.checkRecordRefusal("inventory_sale", {...sale,
      paymentMethod: "", paidNowCents: 0}, "biz"), "not_zelle",
    "a sale entirely on credit took no Zelle");
    assert.equal(z.checkRecordRefusal("container_line_payment",
        {businessId: "biz", method: "zelle", amountCents: 5, reverted: true},
        "biz"), "record_voided");
  });
});

describe("zelle check: who may do what", () => {
  const business = {ownerUid: "boss"};
  const role = (user, uid = "u") => z.bankRoleOf({uid, user,
    businessId: "biz", business});

  it("the owner and a platform admin manage the bank", () => {
    assert.equal(role({role: "admin"}), "owner");
    assert.equal(role({role: "businessOwner", businessId: "biz"}), "owner");
    assert.equal(role({role: "staff", businessId: "biz",
      businessPermissions: ["inventory"]}, "boss"), "owner");
  });

  it("staff of the business with any permission only check", () => {
    assert.equal(role({role: "staff", businessId: "biz",
      businessPermissions: ["inventory"]}), "staff");
    assert.equal(role({role: "staff", businessId: "biz",
      businessPermissions: []}), "none");
    assert.equal(role({role: "staff", businessId: "biz"}), "none");
  });

  it("nobody from another business, and no customers", () => {
    assert.equal(role({role: "businessOwner", businessId: "other"}), "none");
    assert.equal(role({role: "staff", businessId: "other",
      businessPermissions: ["inventory"]}), "none");
    assert.equal(role({role: "customer", businessId: "biz"}), "none");
    assert.equal(role({}), "none");
  });

  it("checks need the section that views the record", () => {
    assert.deepEqual(z.checkAccessPlan("inventory_sale"), {collection:
      "inventorySales", section: "inventory", storeScoped: true});
    assert.deepEqual(z.checkAccessPlan("inventory_credit_payment"),
        {collection: "inventoryCreditPayments", section: "inventory",
          storeScoped: true});
    assert.deepEqual(z.checkAccessPlan("container_line_payment"),
        {collection: "containerLinePayments", section: "containers",
          storeScoped: false});
    assert.equal(z.checkAccessPlan("parking_payment"), null);
    assert.equal(z.checkAccessPlan("__proto__"), null);
  });

  it("staff see connected, status and window; never the bank", () => {
    const link = {itemId: "i", status: "active", institutionName: "Chase",
      accountMask: "1234", accountName: "Checking", windowMinutes: 20,
      accessTokenEnc: "v1:secret", cursor: "c", lastSyncAt: {toMillis: () =>
        AT}};
    assert.deepEqual(z.bankStatusView(link, "staff"), {connected: true,
      status: "active", windowMinutes: 20});
    const owner = z.bankStatusView(link, "owner");
    assert.equal(owner.institutionName, "Chase");
    assert.equal(owner.accountMask, "1234");
    assert.equal(owner.lastSyncAt, AT);
    for (const view of [owner, z.bankStatusView(link, "staff")]) {
      const text = JSON.stringify(view);
      assert.doesNotMatch(text, /secret|accessToken|cursor/);
    }
    assert.deepEqual(z.bankStatusView(null, "owner").connected, false);
    assert.equal(z.bankStatusView(null, "staff").windowMinutes, 15);
    assert.equal(z.bankStatusView({...link, status: "disconnected"}, "owner")
        .institutionName, "");
  });
});

describe("zelle check: settings and bank state", () => {
  it("the window is whole minutes from 2 to 60", () => {
    for (const ok of [2, 15, 60, "30"]) {
      assert.equal(z.cleanWindowMinutes(ok), Number(ok));
    }
    for (const bad of [1, 61, 0, -5, 2.5, "", null, "ten", NaN]) {
      assert.equal(z.cleanWindowMinutes(bad), null, String(bad));
    }
    assert.equal(z.windowMinutesOf(null), 15);
    assert.equal(z.windowMinutesOf({windowMinutes: 99}), 15);
  });

  it("refuses a missing, disconnected or expired bank", () => {
    const link = {itemId: "i", accessTokenEnc: "v1:x", status: "active"};
    assert.equal(z.linkRefusal(link), null);
    assert.equal(z.linkRefusal(null), "bank_not_connected");
    assert.equal(z.linkRefusal({...link, status: "disconnected"}),
        "bank_not_connected");
    assert.equal(z.linkRefusal({windowMinutes: 20}), "bank_not_connected");
    assert.equal(z.linkRefusal({...link, status: "needs_reauth"}),
        "bank_needs_reauth");
  });

  it("asks the bank to refresh at most once a minute", () => {
    assert.equal(z.refreshDue(null, AT), true);
    assert.equal(z.refreshDue({toMillis: () => AT - 59 * 1000}, AT), false);
    assert.equal(z.refreshDue({toMillis: () => AT - 60 * 1000}, AT), true);
  });

  it("picks the chosen depository account, else the first one", () => {
    const accounts = [{account_id: "card", type: "credit"},
      {account_id: "chk", type: "depository"},
      {account_id: "sav", type: "depository"}];
    assert.equal(z.pickDepositoryAccount(accounts, "sav").account_id, "sav");
    assert.equal(z.pickDepositoryAccount(accounts, "card").account_id, "chk");
    assert.equal(z.pickDepositoryAccount(accounts, "").account_id, "chk");
    assert.equal(z.pickDepositoryAccount([{account_id: "card",
      type: "credit"}], ""), null);
  });

  it("every refusal has a kind and a message", () => {
    for (const code of Object.keys(z.BANK_REFUSALS)) {
      assert.ok(z.bankRefusalKind(code));
      assert.ok(z.bankRefusalMessage(code).endsWith("."));
    }
    assert.equal(z.cleanKind("inventory_sale"), "inventory_sale");
    assert.equal(z.cleanKind("toString"), null);
    assert.equal(z.cleanPlatform("IOS"), "ios");
    assert.equal(z.cleanPlatform("desktop"), null);
    assert.equal(z.cleanDocId("a/b"), "");
  });
});

// The callables in index.js, read as source: the same contract tests the
// other services keep (App Check on, secrets bound, nothing hardcoded).
describe("zelle check: callable contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
      "utf8");
  const block = (name) => {
    const start = source.indexOf(`exports.${name} = `);
    assert.ok(start >= 0, `${name} is exported`);
    const next = source.indexOf("\nexports.", start + 10);
    return source.slice(start, next < 0 ? source.length : next);
  };
  const CALLABLES = ["createBankLinkToken", "connectBusinessBank",
    "getBusinessBankStatus", "setBankCheckWindow", "disconnectBusinessBank",
    "checkZellePayment", "confirmZelleCandidate"];
  const REACHES_PLAID = /\b(bankPlaidClient|openBankToken|sealBankToken)\(/;

  for (const name of CALLABLES) {
    it(`${name} enforces App Check and signs in`, () => {
      const body = block(name);
      assert.match(body,
          /= onCall\(\s*\{[^}]*enforceAppCheck: ENFORCE_APP_CHECK/);
      assert.match(body, /requireAuth\(request\)/);
    });
  }

  for (const name of [...CALLABLES, "plaidWebhook"]) {
    it(`${name} binds every secret it reads`, () => {
      const body = block(name);
      if (!REACHES_PLAID.test(body)) return;
      const options = body.slice(0, body.indexOf("async"));
      assert.match(options, /secrets: BANK_SECRETS/);
    });
  }

  it("the webhook verifies Plaid's signature before anything else", () => {
    const body = block("plaidWebhook");
    const verify = body.indexOf("verifyPlaidWebhook(");
    assert.ok(verify > 0);
    assert.ok(verify < body.indexOf(".collection("),
        "nothing is read before the signature is checked");
    assert.match(body, /request\.rawBody|req\.rawBody/);
  });

  it("the access token is stored sealed, never in clear", () => {
    assert.doesNotMatch(source, /accessToken:\s*(exchange|access_token)/);
    assert.doesNotMatch(source, /access_token:\s*exchange/);
    assert.match(block("connectBusinessBank"),
        /accessTokenEnc: sealed/);
    assert.match(block("connectBusinessBank"),
        /const sealed = sealBankToken\(accessToken/);
  });

  it("the rules keep both collections server-only", () => {
    const rules = fs.readFileSync(path.join(__dirname, "..", "..",
        "firestore.rules"), "utf8");
    for (const name of ["businessBankLinks", "businessBankCredits"]) {
      assert.match(rules, new RegExp(`match /${name}/\\{[a-zA-Z]+\\} \\{\\s*` +
        "allow read, write: if false;"));
    }
  });
});
