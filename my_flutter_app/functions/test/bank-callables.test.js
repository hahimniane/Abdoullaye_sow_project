"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {EventEmitter} = require("node:events");
const {afterEach, before, beforeEach, describe, it} = require("node:test");
const admin = require("firebase-admin");

// The Zelle bank check callables and the Plaid webhook, run against the
// Firestore and Auth emulators with Plaid faked at the fetch boundary: what
// zelle-check.test.js and bank-sync.test.js decide in pure code is exercised
// here end to end - the token is stored sealed, a deposit confirms exactly
// one payment, a removed or already-used deposit never confirms, a pending
// deposit that posts keeps its confirmation, and the webhook trusts only
// what Plaid signed.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:bank` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.PLAID_CLIENT_ID = "test-client";
process.env.PLAID_SECRET = "test-secret";
process.env.PLAID_ENV = "sandbox";
process.env.BANK_TOKEN_KEY = crypto.randomBytes(32).toString("base64");
// emulators:exec sets the project; the webhook URL is derived from it.
if (!process.env.GCLOUD_PROJECT) {
  process.env.GCLOUD_PROJECT = "demo-laawol-bank";
}

const functions = require("../index");
const {decryptBankToken} = require("../bank_token_crypto");
const db = admin.firestore();
const {Timestamp} = require("firebase-admin/firestore");

const BIZ = "bank-test-biz";
const OTHER_BIZ = "bank-test-other";
const OWNER = "bank-test-owner";
const CASHIER = "bank-test-cashier";
const PACKER = "bank-test-packer";
const ANNEX_CLERK = "bank-test-annex";
const NOBODY = "bank-test-no-permissions";
const PLATFORM_ADMIN = "bank-test-platform-admin";
const OUTSIDER = "bank-test-outsider";

const call = (name, data, uid = OWNER) =>
  functions[name].run({auth: {uid, token: {}}, data: {businessId: BIZ,
    ...data}});
const reasonOf = async (promise) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error?.details?.reason || error?.message;
  }
};

// ---- Plaid, faked at fetch ------------------------------------------------
const realFetch = global.fetch;
let plaid;
function resetPlaid() {
  plaid = {
    calls: [],
    accessToken: "access-sandbox-1",
    itemId: "item-1",
    accounts: [{account_id: "acc-chk", type: "depository", mask: "1234",
      name: "Business Checking"}, {account_id: "acc-card", type: "credit",
      mask: "9999", name: "Card"}],
    institution: "Chase",
    pages: [],
    syncError: null,
    webhookKey: null,
  };
}
const json = (status, body) => new Response(JSON.stringify(body), {status});
function installPlaid() {
  global.fetch = async (url, init) => {
    if (!String(url).includes("plaid.com")) return realFetch(url, init);
    // Never a real bank: an emulator run is sandbox whatever PLAID_ENV says.
    assert.equal(new URL(url).origin, "https://sandbox.plaid.com");
    const endpoint = new URL(url).pathname;
    const body = JSON.parse(init.body);
    plaid.calls.push({endpoint, body});
    switch (endpoint) {
      case "/link/token/create":
        return json(200, {link_token: "link-sandbox-abc",
          expiration: "2026-10-17T12:00:00Z"});
      case "/item/public_token/exchange":
        if (plaid.exchangeError) {
          return json(400, {error_code: plaid.exchangeError});
        }
        return json(200, {access_token: plaid.accessToken,
          item_id: plaid.itemId});
      case "/accounts/get":
        return json(200, {accounts: plaid.accounts,
          item: {institution_id: "ins_3"}});
      case "/institutions/get_by_id":
        return json(200, {institution: {name: plaid.institution}});
      case "/transactions/refresh":
        if (plaid.refreshError) {
          return json(400, {error_code: plaid.refreshError,
            error_type: "INVALID_REQUEST"});
        }
        return json(200, {request_id: "r"});
      case "/item/remove":
        return json(200, {removed: true});
      case "/webhook_verification_key/get":
        return plaid.webhookKey ? json(200, {key: plaid.webhookKey}) :
          json(400, {error_code: "INVALID_INPUT"});
      case "/transactions/sync": {
        if (plaid.syncError) {
          const error = plaid.syncError;
          if (error.once) plaid.syncError = null;
          return json(400, {error_code: error.code, error_type: error.type});
        }
        const page = plaid.pages.shift() || {added: [], modified: [],
          removed: [], next_cursor: body.cursor || "c0", has_more: false};
        return json(200, page);
      }
      default:
        return json(400, {error_code: "UNKNOWN_ENDPOINT"});
    }
  };
}
const callsTo = (endpoint) =>
  plaid.calls.filter((c) => c.endpoint === endpoint);

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const deposit = (id, cents, atMs, over = {}) => ({
  transaction_id: id, account_id: "acc-chk", amount: -cents / 100,
  iso_currency_code: "USD", date: iso(atMs).slice(0, 10),
  authorized_date: iso(atMs).slice(0, 10), authorized_datetime: iso(atMs),
  datetime: null, name: `Zelle payment from SENDER ${id}`,
  merchant_name: null, pending: false, pending_transaction_id: null,
  counterparties: [], ...over,
});
const page = (added, extra = {}) => ({added, modified: [], removed: [],
  next_cursor: `cur-${Math.random().toString(36).slice(2)}`,
  has_more: false, ...extra});

// ---- Fixtures --------------------------------------------------------------
async function wipeBank() {
  for (const name of ["businessBankLinks", "businessBankCredits",
    "businessBankUsage"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const inbox = await db.collection("users").doc(OWNER)
      .collection("notifications").get();
  await Promise.all(inbox.docs.map((d) => d.ref.delete()));
}

let serial = 0;
async function sale(cents, {method = "zelle", atMs = NOW, storeId = "",
  voided = false, paidNowCents} = {}) {
  const ref = db.collection("inventorySales").doc(`bank-sale-${++serial}`);
  await ref.set({businessId: BIZ, paymentMethod: method, totalCents: cents,
    paidNowCents: paidNowCents ?? cents, creditCents: 0, voided,
    soldByStaffId: CASHIER, storeId, lines: [],
    createdAt: Timestamp.fromMillis(atMs)});
  return ref.id;
}
async function packagePayment(cents, {method = "zelle", atMs = NOW} = {}) {
  const ref = db.collection("containerLinePayments")
      .doc(`bank-pkg-${++serial}`);
  await ref.set({businessId: BIZ, lineId: "line-1", amountCents: cents,
    method, reverted: false, receivedByStaffId: PACKER,
    recordedByStaffId: PACKER, createdAt: Timestamp.fromMillis(atMs)});
  return ref.id;
}
async function creditPayment(cents, {atMs = NOW, storeId = ""} = {}) {
  const ref = db.collection("inventoryCreditPayments")
      .doc(`bank-cp-${++serial}`);
  await ref.set({businessId: BIZ, saleId: "s", storeId, amountCents: cents,
    method: "zelle", reverted: false, receivedByStaffId: CASHIER,
    recordedByStaffId: CASHIER, createdAt: Timestamp.fromMillis(atMs)});
  return ref.id;
}

async function connect(added = []) {
  plaid.pages = [page(added)];
  return call("connectBusinessBank", {publicToken: "public-sandbox-1"});
}

before(async () => {
  // A platform admin must have a verified email in Auth (getUserProfile).
  await admin.auth().createUser({uid: PLATFORM_ADMIN,
    email: "admin@example.test", emailVerified: true})
      .catch((error) => {
        if (error?.code !== "auth/uid-already-exists") throw error;
      });
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Dala Shop",
      status: "approved", enabledServices: ["inventory"], ownerUid: OWNER,
      timeZone: "America/New_York"}),
    db.collection("businesses").doc(OTHER_BIZ).set({name: "Other",
      status: "approved", enabledServices: ["inventory"]}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, email: "owner@example.test"}),
    db.collection("users").doc(CASHIER).set({role: "staff", businessId: BIZ,
      businessPermissions: ["inventory"], email: "cashier@example.test"}),
    db.collection("users").doc(PACKER).set({role: "staff", businessId: BIZ,
      businessPermissions: ["containers"], email: "packer@example.test"}),
    db.collection("users").doc(ANNEX_CLERK).set({role: "staff",
      businessId: BIZ, businessPermissions: ["inventory"],
      inventoryHomeStoreId: "store_annex", email: "annex@example.test"}),
    db.collection("users").doc(NOBODY).set({role: "staff", businessId: BIZ,
      businessPermissions: [], email: "nobody@example.test"}),
    db.collection("users").doc(OUTSIDER).set({role: "businessOwner",
      businessId: OTHER_BIZ, email: "outsider@example.test"}),
    db.collection("users").doc(PLATFORM_ADMIN).set({role: "admin",
      email: "admin@example.test"}),
  ]);
});

beforeEach(async () => {
  resetPlaid();
  installPlaid();
  await wipeBank();
});

afterEach(() => {
  global.fetch = realFetch;
});

// ---- Plaid webhooks, signed like Plaid signs them -----------------------
const {privateKey: WEBHOOK_PRIVATE, publicKey: WEBHOOK_PUBLIC} =
  crypto.generateKeyPairSync("ec", {namedCurve: "P-256"});
const WEBHOOK_KEY = {...WEBHOOK_PUBLIC.export({format: "jwk"}),
  kid: "kid-1", alg: "ES256", expired_at: null};
/**
 * Delivers a webhook to plaidWebhook, signed (or with the given JWT).
 *
 * @param {object} payload The JSON body.
 * @param {object} options {jwt}.
 * @return {Promise<object>} {status, body}.
 */
async function deliverWebhook(payload, {jwt} = {}) {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signed = (body) => {
    const header = b64({alg: "ES256", kid: "kid-1", typ: "JWT"});
    const payload = b64({iat: Math.floor(Date.now() / 1000),
      request_body_sha256: crypto.createHash("sha256").update(body)
          .digest("hex")});
    const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`),
        {key: WEBHOOK_PRIVATE, dsaEncoding: "ieee-p1363"});
    return `${header}.${payload}.${sig.toString("base64url")}`;
  };
  const raw = JSON.stringify(payload);
  const sent = {};
  const res = Object.assign(new EventEmitter(), {
    set() {}, setHeader() {}, getHeader() {}, removeHeader() {},
    status(code) {
      sent.status = code;
      return this;
    },
    send(body) {
      sent.body = body;
      return this;
    },
  });
  const headers = {"plaid-verification": jwt ?? signed(raw)};
  await functions.plaidWebhook({method: "POST", headers, body: payload,
    rawBody: Buffer.from(raw), get: (name) => headers[name.toLowerCase()]},
  res);
  return sent;
}

describe("connecting the bank", () => {
  it("is for the owner only", async () => {
    assert.equal(await reasonOf(call("createBankLinkToken",
        {platform: "web"}, CASHIER)), "bank_owner_required");
    assert.equal(await reasonOf(call("connectBusinessBank",
        {publicToken: "p"}, CASHIER)), "bank_owner_required");
    assert.equal(await reasonOf(call("disconnectBusinessBank", {}, CASHIER)),
        "bank_owner_required");
    assert.equal(await reasonOf(call("setBankCheckWindow", {minutes: 20},
        CASHIER)), "bank_owner_required");
    assert.equal(await reasonOf(call("createBankLinkToken",
        {platform: "web"}, OUTSIDER)), "bank_owner_required");
  });

  it("makes a Link token named Laawol with the derived webhook", async () => {
    const answer = await call("createBankLinkToken", {platform: "android"});
    assert.equal(answer.linkToken, "link-sandbox-abc");
    assert.equal(answer.mode, "connect");
    const [sent] = callsTo("/link/token/create");
    assert.equal(sent.body.client_name, "Laawol");
    // No named customization: production refused "laawol" (see plaid_client).
    assert.equal("link_customization_name" in sent.body, false);
    assert.equal(sent.body.android_package_name, "com.laawoldigital.app");
    assert.match(sent.body.webhook, /cloudfunctions\.net\/plaidWebhook$/);
    assert.equal(await reasonOf(call("createBankLinkToken",
        {platform: "desktop"})), "platform_invalid");
  });

  it("stores the token sealed, picks the depository account, first sync",
      async () => {
        const answer = await connect([deposit("t1", 4000, NOW),
          deposit("out", -2500, NOW),
          deposit("sav", 4000, NOW, {account_id: "acc-card"})]);
        assert.deepEqual(answer, {status: "active", institutionName: "Chase",
          accountMask: "1234", accountName: "Business Checking",
          synced: true});
        const link = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data();
        assert.equal(link.accountId, "acc-chk");
        assert.ok(!JSON.stringify(link).includes("access-sandbox-1"),
            "the access token is never stored in clear");
        assert.equal(decryptBankToken(link.accessTokenEnc,
            process.env.BANK_TOKEN_KEY, BIZ), "access-sandbox-1");
        assert.equal(link.windowMinutes, 15);
        assert.equal(link.connectedByUid, OWNER);
        const credits = await db.collection("businessBankCredits")
            .where("businessId", "==", BIZ).get();
        assert.deepEqual(credits.docs.map((d) => d.id), [`${BIZ}_t1`]);
        assert.equal(credits.docs[0].data().amountCents, 4000);
        assert.equal(credits.docs[0].data().senderName, "SENDER t1");
      });

  it("removes the old login when a new bank is connected over it",
      async () => {
        await connect();
        plaid.accessToken = "access-sandbox-2";
        plaid.itemId = "item-2";
        await connect();
        const removes = callsTo("/item/remove");
        assert.equal(removes.length, 1);
        assert.equal(removes[0].body.access_token, "access-sandbox-1");
        const link = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data();
        assert.equal(link.itemId, "item-2");
      });

  it("removes a login that has no checking or savings account", async () => {
    plaid.accounts = [{account_id: "acc-card", type: "credit"}];
    assert.equal(await reasonOf(connect()), "no_depository_account");
    assert.equal(callsTo("/item/remove").length, 1);
  });

  it("disconnects: Plaid removes the login and the token is gone",
      async () => {
        await connect();
        const answer = await call("disconnectBusinessBank", {});
        assert.equal(answer.status, "disconnected");
        assert.equal(callsTo("/item/remove").length, 1);
        const link = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data();
        assert.equal(link.status, "disconnected");
        assert.equal(link.accessTokenEnc, "");
        assert.equal(await reasonOf(call("checkZellePayment",
            {kind: "inventory_sale", id: await sale(4000)}, CASHIER)),
        "bank_not_connected");
      });
});

describe("what each person sees and sets", () => {
  it("staff see connected, status and window; the owner sees the bank",
      async () => {
        await connect();
        const staff = await call("getBusinessBankStatus", {}, CASHIER);
        assert.deepEqual(staff, {connected: true, status: "active",
          windowMinutes: 15});
        const owner = await call("getBusinessBankStatus", {});
        assert.equal(owner.institutionName, "Chase");
        assert.equal(owner.accountMask, "1234");
        assert.equal(await reasonOf(call("getBusinessBankStatus", {},
            NOBODY)), "bank_access_denied");
        assert.equal(await reasonOf(call("getBusinessBankStatus", {},
            OUTSIDER)), "bank_access_denied");
      });

  it("the owner sets the window, 2 to 60 minutes", async () => {
    assert.equal(await reasonOf(call("setBankCheckWindow", {minutes: 1})),
        "window_invalid");
    assert.equal(await reasonOf(call("setBankCheckWindow", {minutes: 61})),
        "window_invalid");
    assert.deepEqual(await call("setBankCheckWindow", {minutes: 30}),
        {success: true, windowMinutes: 30, refreshLimit: 100});
    assert.equal((await call("getBusinessBankStatus", {}, CASHIER))
        .windowMinutes, 30);
    await connect();
    assert.equal((await call("getBusinessBankStatus", {}, CASHIER))
        .windowMinutes, 30, "connecting keeps the owner's window");
  });
});

describe("checking a Zelle payment", () => {
  it("confirms the one deposit of that amount in the window, once",
      async () => {
        await connect();
        const saleId = await sale(4000);
        plaid.pages = [page([deposit("t1", 4000, NOW + 2 * 60000,
            {counterparties: [{name: "Fatou Bah"}]})])];
        const answer = await call("checkZellePayment",
            {kind: "inventory_sale", id: saleId}, CASHIER);
        assert.equal(answer.result, "confirmed");
        assert.equal(answer.confirmation.amountCents, 4000);
        assert.equal(answer.confirmation.senderName, "Fatou Bah");
        assert.equal(answer.confirmation.institutionName, "Chase");
        const stored = (await db.collection("inventorySales").doc(saleId)
            .get()).data().bankCheck;
        assert.equal(stored.status, "confirmed");
        assert.equal(stored.creditId, `${BIZ}_t1`);
        assert.equal(stored.checkedByUid, CASHIER);
        const credit = (await db.collection("businessBankCredits")
            .doc(`${BIZ}_t1`).get()).data();
        assert.deepEqual(credit.consumedBy, {kind: "inventory_sale",
          id: saleId});
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id: saleId}, CASHIER)).result, "already_confirmed");
        // The same money cannot confirm a second sale of the same amount.
        const twin = await sale(4000);
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id: twin}, CASHIER)).result, "not_found");
        assert.equal((await db.collection("inventorySales").doc(twin).get())
            .data().bankCheck.status, "not_found");
      });

  it("leaves out other amounts, the wrong window and removed deposits",
      async () => {
        await connect([deposit("near", 4001, NOW),
          deposit("late", 4000, NOW + 20 * 60000),
          deposit("gone", 4000, NOW)]);
        plaid.pages = [page([], {removed: [{transaction_id: "gone"}]})];
        const id = await sale(4000);
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id}, CASHIER)).result, "not_found");
        const gone = (await db.collection("businessBankCredits")
            .doc(`${BIZ}_gone`).get()).data();
        assert.equal(gone.removed, true);
      });

  it("puts several same-amount deposits in front of staff", async () => {
    await connect([deposit("a", 2500, NOW - 60000),
      deposit("b", 2500, NOW + 3 * 60000)]);
    const id = await sale(2500);
    const answer = await call("checkZellePayment", {kind: "inventory_sale",
      id}, CASHIER);
    assert.equal(answer.result, "choose");
    assert.deepEqual(answer.candidates.map((c) => c.creditId),
        [`${BIZ}_a`, `${BIZ}_b`]);
    assert.equal(answer.candidates[0].senderName, "SENDER a");
    const confirmed = await call("confirmZelleCandidate", {
      kind: "inventory_sale", id, creditId: `${BIZ}_b`}, CASHIER);
    assert.equal(confirmed.result, "confirmed");
    const other = await sale(2500);
    assert.equal(await reasonOf(call("confirmZelleCandidate", {
      kind: "inventory_sale", id: other, creditId: `${BIZ}_b`}, CASHIER)),
    "candidate_taken");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {
      kind: "inventory_sale", id: other, creditId: `${OTHER_BIZ}_a`},
    CASHIER)), "candidate_invalid");
    // Only "a" is left: one deposit confirms.
    assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
      id: other}, CASHIER)).result, "confirmed");
  });

  it("checks package and credit payments too", async () => {
    await connect([deposit("p", 15000, NOW), deposit("c", 1500, NOW)]);
    const pkg = await packagePayment(15000);
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "container_line_payment", id: pkg}, CASHIER)),
    "This staff account is not allowed to manage this section");
    assert.equal((await call("checkZellePayment", {
      kind: "container_line_payment", id: pkg}, PACKER)).result, "confirmed");
    const cp = await creditPayment(1500);
    assert.equal((await call("checkZellePayment", {
      kind: "inventory_credit_payment", id: cp}, CASHIER)).result,
    "confirmed");
  });

  it("refuses what is not a live Zelle payment", async () => {
    await connect();
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "inventory_sale", id: await sale(4000, {method: "cash"})},
    CASHIER)), "not_zelle");
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "inventory_sale", id: await sale(4000, {voided: true})},
    CASHIER)), "record_voided");
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "inventory_sale", id: "missing"}, CASHIER)), "record_not_found");
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "parking", id: "x"}, CASHIER)), "kind_invalid");
  });

  it("keeps staff of one store to that store's money", async () => {
    await Promise.all([
      db.collection("inventoryConfig").doc(BIZ).set({businessId: BIZ,
        storesConverted: true, multiStore: true, mainStoreId: "store_main"}),
      db.collection("inventoryStores").doc("store_main").set({
        businessId: BIZ, name: "Main", archived: false}),
      db.collection("inventoryStores").doc("store_annex").set({
        businessId: BIZ, name: "Annex", archived: false}),
    ]);
    try {
      await connect([deposit("m", 900, NOW)]);
      const mainSale = await sale(900, {storeId: "store_main"});
      assert.equal(await reasonOf(call("checkZellePayment", {
        kind: "inventory_sale", id: mainSale}, ANNEX_CLERK)),
      "store_not_allowed");
      // Staff with no store see nothing of a multi-store business.
      assert.equal(await reasonOf(call("checkZellePayment", {
        kind: "inventory_sale", id: mainSale}, CASHIER)),
      "store_not_allowed");
      assert.equal((await call("checkZellePayment", {
        kind: "inventory_sale", id: mainSale}, OWNER)).result, "confirmed",
      "the owner checks every store");
    } finally {
      await Promise.all([
        db.collection("inventoryConfig").doc(BIZ).delete(),
        db.collection("inventoryStores").doc("store_main").delete(),
        db.collection("inventoryStores").doc("store_annex").delete(),
      ]);
    }
  });

  it("refuses without a bank, and when the login expired", async () => {
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "inventory_sale", id: await sale(100)}, CASHIER)),
    "bank_not_connected");
    await connect();
    plaid.syncError = {code: "ITEM_LOGIN_REQUIRED", type: "ITEM_ERROR"};
    assert.equal(await reasonOf(call("checkZellePayment", {
      kind: "inventory_sale", id: await sale(100)}, CASHIER)),
    "bank_needs_reauth");
    const link = (await db.collection("businessBankLinks").doc(BIZ).get())
        .data();
    assert.equal(link.status, "needs_reauth");
    // The owner repairs it in update mode with the same login.
    const token = await call("createBankLinkToken", {platform: "ios"});
    assert.equal(token.mode, "update");
    assert.equal(callsTo("/link/token/create").pop().body.access_token,
        "access-sandbox-1");
    // The app calls connectBusinessBank after Reconnect too: the same item
    // is kept (never removed) and set active.
    plaid.syncError = null;
    const repaired = await connect();
    assert.equal(repaired.status, "active");
    assert.equal(callsTo("/item/remove").length, 0);
    assert.equal((await db.collection("businessBankLinks").doc(BIZ).get())
        .data().status, "active");
  });

  it("repairs even when Plaid will not exchange an update-mode token",
      async () => {
        await connect();
        await db.collection("businessBankLinks").doc(BIZ).update({
          status: "needs_reauth", lastErrorCode: "ITEM_LOGIN_REQUIRED"});
        plaid.exchangeError = "INVALID_PUBLIC_TOKEN";
        const answer = await connect();
        assert.equal(answer.status, "active");
        assert.equal(answer.synced, true);
        const link = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data();
        assert.equal(link.status, "active");
        assert.equal(link.itemId, "item-1");
        // Without a broken login to repair, the refusal stands.
        assert.equal(await reasonOf(connect()), "bank_error");
      });

  it("asks the bank to refresh at most once a minute", async () => {
    await connect();
    await call("checkZellePayment", {kind: "inventory_sale",
      id: await sale(300)}, CASHIER);
    await call("checkZellePayment", {kind: "inventory_sale",
      id: await sale(300)}, CASHIER);
    assert.equal(callsTo("/transactions/refresh").length, 1);
    assert.ok(callsTo("/transactions/sync").length >= 3);
  });

  it("refreshes once per record: re-checks of the same payment only sync",
      async () => {
        await connect();
        const id = await sale(310);
        for (let i = 0; i < 4; i += 1) {
          assert.equal((await call("checkZellePayment",
              {kind: "inventory_sale", id}, CASHIER)).result, "not_found");
        }
        assert.equal(callsTo("/transactions/refresh").length, 1);
        assert.ok(callsTo("/transactions/sync").length >= 5);
        const link = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data();
        assert.deepEqual(Object.keys(link.lastRefreshAtByRecord),
            [`inventory_sale:${id}`]);

        // Five minutes on (the stored marks aged), the same payment may ask
        // the bank again - once.
        const aged = Date.now() - 5 * 60 * 1000 - 1000;
        await db.collection("businessBankLinks").doc(BIZ).update({
          lastRefreshAt: Timestamp.fromMillis(aged),
          lastRefreshAtByRecord: {[`inventory_sale:${id}`]: aged}});
        await call("checkZellePayment", {kind: "inventory_sale", id},
            CASHIER);
        await call("checkZellePayment", {kind: "inventory_sale", id},
            CASHIER);
        assert.equal(callsTo("/transactions/refresh").length, 2);
      });

  it("a deposit the webhook syncs confirms on the next free re-check",
      async () => {
        await connect();
        const id = await sale(4321);
        assert.equal((await call("checkZellePayment",
            {kind: "inventory_sale", id}, CASHIER)).result, "not_found");
        assert.equal(callsTo("/transactions/refresh").length, 1);
        // The refresh found it; Plaid says so with SYNC_UPDATES_AVAILABLE.
        plaid.webhookKey = WEBHOOK_KEY;
        plaid.pages = [page([deposit("hook", 4321, NOW + 60000)])];
        assert.equal((await deliverWebhook({webhook_type: "TRANSACTIONS",
          webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1"}))
            .status, 200);
        // The re-check's own sync finds nothing new: the match comes from
        // what the webhook stored, and no second refresh is paid for.
        const again = await call("checkZellePayment",
            {kind: "inventory_sale", id}, CASHIER);
        assert.equal(again.result, "confirmed");
        assert.equal(again.confirmation.amountCents, 4321);
        assert.equal(callsTo("/transactions/refresh").length, 1);
      });

  it("never reaches production Plaid from an emulator", async () => {
    const before = process.env.PLAID_ENV;
    process.env.PLAID_ENV = "production";
    try {
      await connect();
      await call("checkZellePayment", {kind: "inventory_sale",
        id: await sale(320)}, CASHIER);
      assert.ok(plaid.calls.length > 0);
      // installPlaid asserts every call's origin is sandbox.plaid.com.
    } finally {
      process.env.PLAID_ENV = before;
    }
  });

  it("restarts the sync from the saved cursor after a mutation",
      async () => {
        await connect();
        const saved = (await db.collection("businessBankLinks").doc(BIZ)
            .get()).data().cursor;
        plaid.syncError = {code:
          "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", once: true};
        plaid.pages = [page([deposit("r", 777, NOW)])];
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id: await sale(777)}, CASHIER)).result, "confirmed");
        const syncs = callsTo("/transactions/sync").slice(-2);
        assert.deepEqual(syncs.map((s) => s.body.cursor), [saved, saved]);
      });

  it("a pending deposit that posts keeps the payment it confirmed",
      async () => {
        await connect([deposit("pend", 5000, NOW, {pending: true})]);
        const first = await sale(5000);
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id: first}, CASHIER)).result, "confirmed");
        // The bank posts it under a new id and removes the pending one.
        plaid.pages = [page([deposit("posted", 5000, NOW,
            {pending_transaction_id: "pend"})],
        {removed: [{transaction_id: "pend"}]})];
        const second = await sale(5000);
        assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
          id: second}, CASHIER)).result, "not_found");
        const posted = (await db.collection("businessBankCredits")
            .doc(`${BIZ}_posted`).get()).data();
        assert.deepEqual(posted.consumedBy, {kind: "inventory_sale",
          id: first});
        const pend = (await db.collection("businessBankCredits")
            .doc(`${BIZ}_pend`).get()).data();
        assert.equal(pend.removed, true);
        assert.equal(pend.replacedByTransactionId, "posted");
      });
});


// ---- Check bank any time (docs/ZELLE_BANK_CHECK.md) ----------------------
const check = (data, uid = CASHIER) => call("checkZellePayment",
    {mode: "standalone", since: "15m", ...data}, uid);
const usageNow = async () => {
  const snap = await db.collection("businessBankUsage")
      .where("businessId", "==", BIZ).get();
  return snap.docs[0]?.data() || null;
};
const limitNotices = async () => (await db.collection("users").doc(OWNER)
    .collection("notifications").get()).docs
    .filter((d) => d.data().data?.type === "bank_check_limit");
const creditOf = async (id) => (await db.collection("businessBankCredits")
    .doc(`${BIZ}_${id}`).get()).data();
// Lets the business-wide 60 s throttle pass without waiting a minute.
const pastThrottle = () => db.collection("businessBankLinks").doc(BIZ)
    .update({lastRefreshAt: Timestamp.fromMillis(Date.now() - 61000)});

describe("check bank any time", () => {
  it("finds the deposit of that exact amount, and consumes nothing",
      async () => {
        const at = Date.now() - 5 * 60000;
        await connect([deposit("cb1", 4200, at,
            {counterparties: [{name: "Awa Diallo"}]}),
        deposit("cb-other", 4201, at)]);
        const answer = await check({amountCents: 4200});
        assert.equal(answer.result, "received");
        assert.equal(answer.since, "15m");
        assert.equal(answer.limitReached, false);
        assert.deepEqual(answer.deposits, [{creditId: `${BIZ}_cb1`,
          amountCents: 4200, atMs: at, timeKnown: true,
          senderName: "Awa Diallo", pending: false}]);
        assert.equal((await creditOf("cb1")).consumedBy, undefined,
            "looking consumes nothing");
        // Package staff may check too (they take payments).
        assert.equal((await check({amountCents: 4200}, PACKER)).result,
            "received");
      });

  it("keeps to the window: 15 minutes, the hour, today", async () => {
    const now = Date.now();
    await connect([deposit("forty", 1500, now - 40 * 60000),
      deposit("old", 1600, now - 30 * 60 * 60000)]);
    assert.equal((await check({amountCents: 1500})).result, "not_found");
    assert.equal((await check({amountCents: 1500, since: "1h"})).result,
        "received");
    assert.equal((await check({amountCents: 1600, since: "today"})).result,
        "not_found", "yesterday is not today");
    const edge = await check({amountCents: 1500, since: "1h"});
    assert.ok(edge.fromMs <= now - 60 * 60000 + 5000 &&
      edge.fromMs >= now - 60 * 60000 - 60000);
  });

  it("lists several by sender and time, newest first", async () => {
    const now = Date.now();
    await connect([deposit("s-a", 2500, now - 10 * 60000),
      deposit("s-b", 2500, now - 60000, {pending: true})]);
    const answer = await check({amountCents: 2500});
    assert.equal(answer.result, "several");
    assert.deepEqual(answer.deposits.map((d) => [d.senderName, d.pending]),
        [["SENDER s-b", true], ["SENDER s-a", false]]);
  });

  it("leaves out deposits already used or removed", async () => {
    await connect([deposit("used", 5100, NOW)]);
    const saleId = await sale(5100);
    assert.equal((await call("checkZellePayment", {kind: "inventory_sale",
      id: saleId}, CASHIER)).result, "confirmed");
    assert.equal((await check({amountCents: 5100, since: "today"})).result,
        "not_found");
    plaid.pages = [page([deposit("gone", 5200, Date.now())])];
    await pastThrottle();
    assert.equal((await check({amountCents: 5200})).result, "received");
    await db.collection("businessBankCredits").doc(`${BIZ}_gone`)
        .update({removed: true});
    assert.equal((await check({amountCents: 5200, auto: true})).result,
        "not_found");
  });

  it("who may check, and what is refused", async () => {
    assert.equal(await reasonOf(check({amountCents: 100})),
        "bank_not_connected");
    await connect();
    assert.equal(await reasonOf(check({amountCents: 100}, NOBODY)),
        "bank_access_denied");
    assert.equal(await reasonOf(check({amountCents: 100}, OUTSIDER)),
        "bank_access_denied");
    assert.equal((await check({amountCents: 100}, OWNER)).result,
        "not_found");
    assert.equal((await check({amountCents: 100}, PLATFORM_ADMIN)).result,
        "not_found");
    assert.equal(await reasonOf(check({amountCents: "42.00"})),
        "check_amount_invalid");
    assert.equal(await reasonOf(check({amountCents: 0})),
        "check_amount_invalid");
    assert.equal(await reasonOf(check({amountCents: 100, since: "week"})),
        "since_invalid");
    assert.equal(await reasonOf(call("checkZellePayment", {mode: "peek",
      amountCents: 100}, CASHIER)), "mode_invalid");
  });

  it("counts checks and paid refreshes; automatic re-checks are free",
      async () => {
        await connect();
        await check({amountCents: 700});
        for (let i = 0; i < 3; i += 1) {
          await check({amountCents: 700, auto: true});
        }
        // One paid refresh per amount in 5 minutes, whoever presses.
        await check({amountCents: 700}, PACKER);
        assert.equal(callsTo("/transactions/refresh").length, 1);
        const usage = await usageNow();
        assert.equal(usage.checks, 2);
        assert.equal(usage.refreshes, 1);
        assert.equal(usage.linkActive, true);
        assert.deepEqual(usage.byUid[CASHIER], {checks: 1, refreshes: 1});
        assert.deepEqual(usage.byUid[PACKER], {checks: 1});
        // A record check counts too; its automatic re-checks do not.
        const id = await sale(710);
        await pastThrottle();
        await call("checkZellePayment", {kind: "inventory_sale", id},
            CASHIER);
        await call("checkZellePayment", {kind: "inventory_sale", id,
          auto: true}, CASHIER);
        const after = await usageNow();
        assert.deepEqual([after.checks, after.refreshes], [3, 2]);
        // The owner sees it, with names and the estimated cost; staff not.
        const owner = await call("getBusinessBankStatus", {});
        assert.equal(owner.refreshLimit, 100);
        assert.deepEqual({...owner.usage, byStaff: undefined}, {
          month: owner.usage.month, checks: 3, refreshes: 2,
          refreshesFailed: 0, estimatedCostCents: 24, refreshLimit: 100,
          limitReached: false, byStaff: undefined});
        assert.deepEqual(owner.usage.byStaff, [
          {uid: CASHIER, name: "cashier@example.test", checks: 2,
            refreshes: 2},
          {uid: PACKER, name: "packer@example.test", checks: 1,
            refreshes: 0}]);
        const staff = await call("getBusinessBankStatus", {}, CASHIER);
        assert.equal("usage" in staff, false);
        assert.equal("refreshLimit" in staff, false);
      });

  it("a refresh the bank refuses is not billed", async () => {
    await connect();
    plaid.refreshError = "PRODUCTS_NOT_SUPPORTED";
    assert.equal((await check({amountCents: 720})).result, "not_found");
    assert.equal(callsTo("/transactions/refresh").length, 1);
    const usage = await usageNow();
    assert.deepEqual([usage.checks, usage.refreshes, usage.refreshesFailed,
      usage.byUid[CASHIER].refreshes], [1, 0, 1, 0]);
  });

  it("only the owner sets the monthly limit, 0 to 1000", async () => {
    await connect();
    assert.equal(await reasonOf(call("setBankCheckWindow",
        {refreshLimit: 5}, CASHIER)), "bank_owner_required");
    assert.equal(await reasonOf(call("setBankCheckWindow",
        {refreshLimit: 1001})), "limit_invalid");
    assert.equal(await reasonOf(call("setBankCheckWindow",
        {refreshLimit: -1})), "limit_invalid");
    assert.deepEqual(await call("setBankCheckWindow", {refreshLimit: 0}),
        {success: true, windowMinutes: 15, refreshLimit: 0});
    assert.deepEqual(await call("setBankCheckWindow", {refreshLimit: 250,
      minutes: 20}), {success: true, windowMinutes: 20, refreshLimit: 250});
    // Reconnecting keeps the owner's limit.
    await connect();
    assert.equal((await call("getBusinessBankStatus", {})).refreshLimit,
        250);
  });

  it("at the limit: checks still answer, never refresh, one notice",
      async () => {
        await connect();
        await call("setBankCheckWindow", {refreshLimit: 2});
        await check({amountCents: 801});
        assert.equal((await limitNotices()).length, 0);
        await pastThrottle();
        const second = await check({amountCents: 802});
        assert.equal(second.limitReached, true, "the second reached it");
        assert.equal(callsTo("/transactions/refresh").length, 2);
        const notices = await limitNotices();
        assert.equal(notices.length, 1);
        assert.equal(notices[0].data().title,
            "Bank checks hit this month's limit");
        // Beyond it: still answers (from a free sync), no refresh, no
        // second notice.
        plaid.pages = [page([deposit("late", 803, Date.now())])];
        await pastThrottle();
        const third = await check({amountCents: 803});
        assert.equal(third.result, "received");
        assert.equal(third.limitReached, true);
        assert.equal(callsTo("/transactions/refresh").length, 2);
        assert.ok(callsTo("/transactions/sync").length >= 4);
        await pastThrottle();
        await call("checkZellePayment", {kind: "inventory_sale",
          id: await sale(804)}, CASHIER);
        assert.equal(callsTo("/transactions/refresh").length, 2,
            "the limit holds for record checks too");
        assert.equal((await limitNotices()).length, 1);
        assert.equal((await usageNow()).refreshes, 2);
        // Raising the limit lets refreshes (and, later, a notice) resume.
        await call("setBankCheckWindow", {refreshLimit: 3});
        assert.equal((await usageNow()).limitNoticeAt, undefined);
        await pastThrottle();
        await check({amountCents: 805});
        assert.equal(callsTo("/transactions/refresh").length, 3);
        assert.equal((await limitNotices()).length, 2);
      });

  it("concurrent checks cannot overshoot the limit", async () => {
    await connect();
    await call("setBankCheckWindow", {refreshLimit: 2});
    const {month} = (await call("getBusinessBankStatus", {})).usage;
    await db.collection("businessBankUsage").doc(`${BIZ}_${month}`).set({
      businessId: BIZ, month, refreshes: 1, checks: 1});
    const amounts = [901, 902, 903, 904, 905, 906];
    const answers = await Promise.all(amounts.map((amountCents, i) =>
      check({amountCents}, i % 2 ? PACKER : CASHIER)));
    assert.ok(answers.every((a) => a.result === "not_found"));
    assert.equal(callsTo("/transactions/refresh").length, 1);
    const usage = await usageNow();
    assert.equal(usage.refreshes, 2);
    assert.equal(usage.checks, 7);
    assert.equal((await limitNotices()).length, 1);
  });
});

describe("check bank: use for a sale", () => {
  it("lists what the deposit can pay, then spends it once", async () => {
    const at = Date.now() - 3 * 60000;
    await connect([deposit("use1", 3300, at,
        {counterparties: [{name: "Awa Diallo"}]})]);
    // Rung up two hours ago: outside any record window, but standing.
    const saleId = await sale(3300, {atMs: Date.now() - 2 * 3600000});
    await db.collection("inventorySales").doc(saleId).update({
      lines: [{name: "Rice 25kg", quantity: 2}],
      credit: {customerName: "Awa"}});
    const cashSale = await sale(3300, {method: "cash"});
    const otherAmount = await sale(3400);
    const pkg = await packagePayment(3300);
    const found = await check({amountCents: 3300});
    assert.equal(found.result, "received");
    const creditId = found.deposits[0].creditId;

    const forCashier = await call("confirmZelleCandidate", {mode: "records",
      creditId}, CASHIER);
    assert.equal(forCashier.searched, false);
    assert.deepEqual(forCashier.records.map((r) => [r.kind, r.id]),
        [["inventory_sale", saleId]], "no package payment without " +
        "containers; no cash sale; no other amount");
    assert.deepEqual([forCashier.records[0].who,
      forCashier.records[0].what, forCashier.records[0].amountCents],
    ["Awa", "2 x Rice 25kg", 3300]);
    const forPacker = await call("confirmZelleCandidate", {mode: "records",
      creditId}, PACKER);
    assert.deepEqual(forPacker.records.map((r) => r.id), [pkg]);
    const forOwner = await call("confirmZelleCandidate", {mode: "records",
      creditId}, OWNER);
    assert.deepEqual(forOwner.records.map((r) => r.id).sort(),
        [saleId, pkg].sort());
    const searched = await call("confirmZelleCandidate", {mode: "records",
      creditId, query: "rice"}, OWNER);
    assert.deepEqual([searched.searched, searched.records.map((r) => r.id)],
        [true, [saleId]]);
    assert.deepEqual((await call("confirmZelleCandidate", {mode: "records",
      creditId, query: "nobody"}, OWNER)).records, []);

    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "inventory_sale", id: otherAmount}, CASHIER)),
    "amount_mismatch");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "inventory_sale", id: cashSale}, CASHIER)),
    "not_zelle");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "container_line_payment", id: pkg}, CASHIER)),
    "This staff account is not allowed to manage this section");

    const used = await call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "inventory_sale", id: saleId}, CASHIER);
    assert.equal(used.result, "confirmed");
    assert.equal(used.confirmation.senderName, "Awa Diallo");
    const stored = (await db.collection("inventorySales").doc(saleId).get())
        .data().bankCheck;
    assert.deepEqual([stored.status, stored.creditId, stored.checkedByUid],
        ["confirmed", creditId, CASHIER]);
    assert.deepEqual((await creditOf("use1")).consumedBy,
        {kind: "inventory_sale", id: saleId});
    // Once: not for the package payment, not listed, not found again.
    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "container_line_payment", id: pkg}, PACKER)),
    "candidate_taken");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {
      mode: "records", creditId}, OWNER)), "candidate_taken");
    assert.equal((await call("confirmZelleCandidate", {mode: "use",
      creditId, kind: "inventory_sale", id: saleId}, CASHIER)).result,
    "already_confirmed");
    assert.equal((await check({amountCents: 3300, auto: true})).result,
        "not_found");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "swap",
      creditId}, CASHIER)), "mode_invalid");
  });

  it("two people using one deposit at once: exactly one wins", async () => {
    await connect([deposit("race", 3500, Date.now())]);
    const a = await sale(3500);
    const b = await packagePayment(3500);
    const outcome = async (promise) => {
      for (let i = 0; i < 5; i += 1) {
        const reason = await reasonOf(promise());
        // The emulator may give up on a contended transaction (see
        // testing-agent.md): retry only that, never a refusal.
        if (typeof reason === "string" && /invalid or closed|ABORTED|10 /
            .test(reason)) continue;
        return reason;
      }
      return "gave up";
    };
    const results = await Promise.all([
      outcome(() => call("confirmZelleCandidate", {mode: "use",
        creditId: `${BIZ}_race`, kind: "inventory_sale", id: a}, OWNER)),
      outcome(() => call("confirmZelleCandidate", {mode: "use",
        creditId: `${BIZ}_race`, kind: "container_line_payment", id: b},
      OWNER)),
    ]);
    assert.deepEqual(results.sort(), ["candidate_taken", "ok"]);
    const confirmed = await Promise.all([
      db.collection("inventorySales").doc(a).get(),
      db.collection("containerLinePayments").doc(b).get()]);
    assert.equal(confirmed.filter((d) => d.data().bankCheck?.status ===
      "confirmed").length, 1);
  });

  it("a deposit from before yesterday cannot be used", async () => {
    await connect([deposit("stale", 3600, Date.now() - 3 * 86400000)]);
    const id = await sale(3600);
    assert.equal(await reasonOf(call("confirmZelleCandidate", {mode: "use",
      creditId: `${BIZ}_stale`, kind: "inventory_sale", id}, OWNER)),
    "candidate_invalid");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {
      mode: "records", creditId: `${BIZ}_stale`}, OWNER)),
    "candidate_invalid");
    assert.equal(await reasonOf(call("confirmZelleCandidate", {
      mode: "records", creditId: `${OTHER_BIZ}_x`}, OWNER)),
    "candidate_invalid");
  });

  it("staff of one store see only that store's records", async () => {
    await Promise.all([
      db.collection("inventoryConfig").doc(BIZ).set({businessId: BIZ,
        storesConverted: true, multiStore: true, mainStoreId: "store_main"}),
      db.collection("inventoryStores").doc("store_main").set({
        businessId: BIZ, name: "Main", archived: false}),
      db.collection("inventoryStores").doc("store_annex").set({
        businessId: BIZ, name: "Annex", archived: false}),
    ]);
    try {
      await connect([deposit("st", 3700, Date.now())]);
      const main = await sale(3700, {storeId: "store_main"});
      const annex = await sale(3700, {storeId: "store_annex"});
      const list = async (uid) => (await call("confirmZelleCandidate", {
        mode: "records", creditId: `${BIZ}_st`}, uid)).records
          .map((r) => r.id).sort();
      assert.deepEqual(await list(ANNEX_CLERK), [annex]);
      assert.deepEqual(await list(CASHIER), []);
      assert.deepEqual(await list(OWNER), [main, annex].sort());
      assert.equal(await reasonOf(call("confirmZelleCandidate", {
        mode: "use", creditId: `${BIZ}_st`, kind: "inventory_sale",
        id: main}, ANNEX_CLERK)), "store_not_allowed");
    } finally {
      await Promise.all([
        db.collection("inventoryConfig").doc(BIZ).delete(),
        db.collection("inventoryStores").doc("store_main").delete(),
        db.collection("inventoryStores").doc("store_annex").delete(),
      ]);
    }
  });
});

describe("the Plaid webhook", () => {
  const deliver = deliverWebhook;

  beforeEach(() => {
    plaid.webhookKey = WEBHOOK_KEY;
  });

  it("refuses what Plaid did not sign", async () => {
    await connect();
    const sent = await deliver({webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1"},
    {jwt: "a.b.c"});
    assert.equal(sent.status, 401);
  });

  it("syncs on TRANSACTIONS and tracks the login on ITEM", async () => {
    await connect();
    plaid.pages = [page([deposit("w", 1234, NOW)])];
    assert.equal((await deliver({webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1"})).status,
    200);
    assert.ok((await db.collection("businessBankCredits").doc(`${BIZ}_w`)
        .get()).exists);
    await deliver({webhook_type: "ITEM", webhook_code: "ERROR",
      item_id: "item-1", error: {error_code: "ITEM_LOGIN_REQUIRED"}});
    let link = (await db.collection("businessBankLinks").doc(BIZ).get())
        .data();
    assert.equal(link.status, "needs_reauth");
    await deliver({webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED",
      item_id: "item-1"});
    link = (await db.collection("businessBankLinks").doc(BIZ).get()).data();
    assert.equal(link.status, "active");
    assert.equal((await deliver({webhook_type: "ITEM",
      webhook_code: "ERROR", item_id: "unknown"})).body.unknownItem, true);
  });
});
