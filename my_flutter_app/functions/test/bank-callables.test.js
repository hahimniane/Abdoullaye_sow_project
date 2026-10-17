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
    const endpoint = new URL(url).pathname;
    const body = JSON.parse(init.body);
    plaid.calls.push({endpoint, body});
    switch (endpoint) {
      case "/link/token/create":
        return json(200, {link_token: "link-sandbox-abc",
          expiration: "2026-10-17T12:00:00Z"});
      case "/item/public_token/exchange":
        return json(200, {access_token: plaid.accessToken,
          item_id: plaid.itemId});
      case "/accounts/get":
        return json(200, {accounts: plaid.accounts,
          item: {institution_id: "ins_3"}});
      case "/institutions/get_by_id":
        return json(200, {institution: {name: plaid.institution}});
      case "/transactions/refresh":
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
  for (const name of ["businessBankLinks", "businessBankCredits"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
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
        {success: true, windowMinutes: 30});
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

describe("the Plaid webhook", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("ec",
      {namedCurve: "P-256"});
  const jwk = publicKey.export({format: "jwk"});
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signed = (body) => {
    const header = b64({alg: "ES256", kid: "kid-1", typ: "JWT"});
    const payload = b64({iat: Math.floor(Date.now() / 1000),
      request_body_sha256: crypto.createHash("sha256").update(body)
          .digest("hex")});
    const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`),
        {key: privateKey, dsaEncoding: "ieee-p1363"});
    return `${header}.${payload}.${sig.toString("base64url")}`;
  };
  const deliver = async (payload, {jwt} = {}) => {
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
  };

  beforeEach(() => {
    plaid.webhookKey = {...jwk, kid: "kid-1", alg: "ES256", expired_at: null};
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
