"use strict";

/* global globalThis */

// Pay now on package requests (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 3),
// end to end against the Firestore emulator: the optional pay link created
// when a request is confirmed, the link's Stripe Checkout Session, the
// webhook that marks it paid and writes the ledger, refunds, Received, the
// weekly payouts and the Laawol bill. Stripe and Meta are faked at the
// `fetch` boundary: nothing here can reach the real ones.
//
// Run through `npm run test:pay-now` (firebase emulators:exec).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {EventEmitter} = require("node:events");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:pay-now` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the real " +
      "project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "109876543210";
process.env.STRIPE_SECRET_KEY = "sk_test_paynow";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_paynow";
process.env.CUSTOMER_CONSOLE_URL = "https://customer.laawoldigital.com";

const functions = require("../index");
const pay = require("../package_pay_now");
// Admins are checked against Auth for a verified email; the suite has none.
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();

const BIZ = "pn-biz";
const DIRECT_BIZ = "pn-direct-biz";
const PAYOUT_BIZ = "pn-payout-biz";
const OTHER_BIZ = "pn-other-biz";
const OWNER = "pn-owner";
const DIRECT_OWNER = "pn-direct-owner";
const PAYOUT_OWNER = "pn-payout-owner";
const OTHER_OWNER = "pn-other-owner";
const COUNTER = "pn-counter-staff";
const LEDGER_STAFF = "pn-ledger-staff";
const FINANCE = "pn-finance";
const SUPER = "pn-super";
const DIRECT_ACCOUNT = "acct_pn_direct";
const ANON = {firebase: {sign_in_provider: "anonymous"}};
const DAY = 24 * 60 * 60 * 1000;

const WEEK = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat",
  "sun"].map((day) => [day, {open: true, from: "09:00", to: "18:00"}]));

const call = (name, data, uid = OWNER, token = {}) =>
  functions[name].run({auth: {uid, token}, data, rawRequest: {}});
const staff = (name, data, uid = OWNER, businessId = BIZ) =>
  call(name, {businessId, ...data}, uid);
const settings = (data, uid = OWNER, businessId = BIZ) =>
  call("setPackageRequestSettings", {businessId, ...data}, uid);
const reasonOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.details?.reason || error.code;
  }
  return "no error";
};
const requestDoc = async (id) =>
  (await db.collection("packageRequests").doc(id).get()).data();

let phones = 0;
const freshPhone = () => `+1646556${String(1000 + (++phones)).slice(-4)}`;
let keys = 0;
const todayPlus = (days) => new Date(Date.now() - 4 * 3600 * 1000 +
  days * DAY).toISOString().slice(0, 10);
const submission = (businessId, extra = {}) => ({
  businessId,
  destinationCountryId: "gn",
  handoff: "bring_in",
  locationId: "default",
  plannedDate: todayPlus(3),
  sender: {name: "Fatou Diallo", phoneE164: freshPhone()},
  receiver: {name: "Mariama Bah", phoneE164: "+224620000000"},
  pieces: [{kind: "barrel"}],
  language: "en",
  idempotencyKey: `pn-key-${Date.now()}-${++keys}`,
  ...extra,
});

// ---- Fakes --------------------------------------------------------------

const realFetch = globalThis.fetch;
const whatsapp = {calls: [], mode: "ok"};
const stripe = {calls: [], sessions: new Map(), intents: new Map(),
  seq: 0, refunds: 0, failRefund: false, chargedAtMs: 0};
const feeFor = (amount) => Math.round(amount * 0.029) + 30;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status});
}

function fakeStripe(url, init = {}) {
  const u = new URL(String(url));
  const path = u.pathname.replace(/^\/v1/, "");
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body ?
    Object.fromEntries(new URLSearchParams(init.body.toString())) : {};
  const headers = init.headers || {};
  stripe.calls.push({method, path, headers, body});
  let match;
  if (method === "POST" && path === "/checkout/sessions") {
    const id = `cs_test_${++stripe.seq}`;
    const metadata = {};
    for (const [key, value] of Object.entries(body)) {
      const found = /^metadata\[(.+)\]$/.exec(key);
      if (found) metadata[found[1]] = value;
    }
    const session = {id, url: `https://checkout.stripe.test/${id}`,
      status: "open", payment_status: "unpaid", payment_intent: null,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      amount_total: Number(body["line_items[0][price_data][unit_amount]"]),
      metadata, account: headers["Stripe-Account"] || ""};
    stripe.sessions.set(id, session);
    return json(session);
  }
  if ((match = /^\/checkout\/sessions\/(.+)$/.exec(path))) {
    const session = stripe.sessions.get(match[1]);
    return session ? json(session) : json({error: {message: "no"}}, 404);
  }
  if ((match = /^\/payment_intents\/(.+)$/.exec(path))) {
    const intent = stripe.intents.get(match[1]);
    return intent ? json(intent) : json({error: {message: "no"}}, 404);
  }
  if ((match = /^\/charges\/(.+)$/.exec(path))) {
    return json({id: match[1], created: Math.floor((stripe.chargedAtMs ||
      Date.now()) / 1000), balance_transaction: `txn_${match[1]}`});
  }
  if ((match = /^\/balance_transactions\/txn_ch_(.+)$/.exec(path))) {
    const intent = stripe.intents.get(`pi_${match[1]}`);
    const fee = feeFor(intent ? intent.amount : 0);
    return json({id: `txn_ch_${match[1]}`, fee, fee_details: [
      {type: "stripe_fee", amount: fee}]});
  }
  if (method === "POST" && path === "/refunds") {
    if (stripe.failRefund) return json({error: {message: "declined"}}, 402);
    return json({id: `re_test_${++stripe.refunds}`, status: "succeeded",
      amount: Number(body.amount), payment_intent: body.payment_intent});
  }
  return json({error: {message: `unfaked ${method} ${path}`}}, 404);
}

function fakeWhatsApp(url, init = {}) {
  const body = JSON.parse(init.body);
  whatsapp.calls.push(body);
  if (whatsapp.mode === "template_missing" && body.type === "template") {
    return json({error: {code: 132001, message:
      "Template name does not exist in the translation"}}, 404);
  }
  return json({messages: [{id: `wamid.${whatsapp.calls.length}`}]});
}

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.startsWith("https://api.stripe.com/")) return fakeStripe(url, init);
  if (href.includes("graph.facebook.com") && href.endsWith("/messages")) {
    return fakeWhatsApp(url, init);
  }
  return realFetch(url, init);
};

const stripeCalls = (method, path) => stripe.calls.filter((c) =>
  c.method === method && c.path === path);
const templatesTo = (name) => whatsapp.calls.filter((c) =>
  c.type === "template" && c.template.name === name);

// A response the onRequest wrapper can run against: an emitter that says
// "finish" when the handler answers.
function fakeResponse(sent) {
  const res = Object.assign(new EventEmitter(), {
    set() {}, setHeader() {}, getHeader() {}, removeHeader() {}, end() {},
    status(code) {
      sent.status = code;
      return this;
    },
    send(body) {
      sent.body = body;
      this.emit("finish");
      return this;
    },
    json(body) {
      sent.body = body;
      this.emit("finish");
      return this;
    },
    redirect(code, to) {
      sent.status = code;
      sent.redirect = to;
      this.emit("finish");
      return this;
    },
  });
  return res;
}

// The durable /p link, as a browser would visit it.
async function visit(token) {
  const sent = {};
  await functions.parkingPaymentLink({method: "GET", query: {t: token},
    headers: {}, get: () => ""}, fakeResponse(sent));
  return sent;
}

let eventSeq = 0;
async function deliver(event) {
  event.id = event.id || `evt_pn_${++eventSeq}`;
  const raw = JSON.stringify({livemode: true, created: 1, ...event});
  const t = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256",
      process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`)
      .digest("hex");
  const headers = {"stripe-signature": `t=${t},v1=${signature}`};
  const sent = {};
  await functions.handleBusinessProStripeWebhook({method: "POST", headers,
    rawBody: Buffer.from(raw), get: (name) => headers[name.toLowerCase()]},
  fakeResponse(sent));
  return sent;
}

/**
 * The customer pays the request's Checkout Session: the session completes,
 * a succeeded PaymentIntent exists, and Stripe's event reaches the webhook.
 *
 * @param {string} requestId The request.
 * @param {object} [options] {account, event: false to only prepare}.
 * @return {Promise<object>} {event, intent, session, sent}.
 */
async function customerPays(requestId, options = {}) {
  const request = await requestDoc(requestId);
  const session = [...stripe.sessions.values()].reverse().find((s) =>
    s.metadata.requestId === requestId);
  assert.ok(session, "a session was minted for the request");
  const n = ++stripe.seq;
  const intent = {id: `pi_${n}`, status: "succeeded",
    amount: session.amount_total, amount_received: session.amount_total,
    latest_charge: `ch_${n}`, metadata: session.metadata};
  stripe.intents.set(intent.id, intent);
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = intent.id;
  const event = {type: "checkout.session.completed",
    ...(session.account ? {account: session.account} : {}),
    data: {object: {...session}}};
  assert.equal(request.businessId, session.metadata.businessId);
  const sent = options.event === false ? null : await deliver(event);
  return {event, intent, session, sent};
}

async function ledgerFor(requestId) {
  const snap = await db.collection("payNowLedger")
      .where("requestId", "==", requestId).get();
  return snap.docs.map((d) => ({id: d.id, ...d.data()}))
      .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A request, submitted and confirmed by its customer (barrels only: priced
 * by the destination, so the total is exact).
 *
 * @param {string} businessId The business.
 * @param {number} barrels How many barrels.
 * @return {Promise<object>} {requestId, token, code, request}.
 */
async function confirmedRequest(businessId = BIZ, barrels = 1) {
  const sent = await call("submitPackageRequest", submission(businessId,
      {pieces: Array.from({length: barrels}, () => ({kind: "barrel"}))}),
  `anon-pn-${keys + 1}`, ANON);
  assert.equal(sent.status, "estimate_sent");
  await call("confirmPackageEstimate", {token: sent.token, version: 1});
  return {requestId: sent.requestId, token: sent.token, code: sent.code,
    request: await requestDoc(sent.requestId)};
}

before(async () => {
  const business = (extra) => ({status: "approved", phone: "+16465550199",
    addressLine1: "410 East 138th Street", city: "Bronx", state: "NY",
    country: "United States", ...extra});
  await Promise.all([
    db.collection("businesses").doc(BIZ).set(business({
      name: "Dala Shipping", ownerUid: OWNER})),
    db.collection("businesses").doc(DIRECT_BIZ).set(business({
      name: "Direct Shipping", ownerUid: DIRECT_OWNER,
      stripeAccountId: DIRECT_ACCOUNT, payoutsEnabled: true})),
    db.collection("businesses").doc(PAYOUT_BIZ).set(business({
      name: "Payout Shipping", ownerUid: PAYOUT_OWNER})),
    db.collection("businesses").doc(OTHER_BIZ).set(business({
      name: "Other Shipping", ownerUid: OTHER_OWNER})),
    ...[BIZ, DIRECT_BIZ].map((id) => db.collection("businesses").doc(id)
        .collection("destinationCountries").doc("gn")
        .set({name: "Guinea", isActive: true, barrelShippingPrice: 150})),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Dala Owner", email: "o@example.test"}),
    db.collection("users").doc(DIRECT_OWNER).set({role: "businessOwner",
      businessId: DIRECT_BIZ, fullName: "Direct Owner"}),
    db.collection("users").doc(PAYOUT_OWNER).set({role: "businessOwner",
      businessId: PAYOUT_BIZ, fullName: "Alhoussaine Sow",
      phoneE164: "+16465550101"}),
    db.collection("users").doc(OTHER_OWNER).set({role: "businessOwner",
      businessId: OTHER_BIZ, fullName: "Other Owner"}),
    db.collection("users").doc(COUNTER).set({role: "staff", businessId: BIZ,
      businessPermissions: ["containers"], fullName: "Counter Staff"}),
    db.collection("users").doc(LEDGER_STAFF).set({role: "staff",
      businessId: BIZ, businessPermissions: ["containers", "ledger"],
      fullName: "Ledger Staff"}),
    db.collection("users").doc(FINANCE).set({role: "admin",
      adminRole: "financeManager", fullName: "Finance Admin"}),
    db.collection("users").doc(SUPER).set({role: "admin",
      adminRole: "superAdmin", fullName: "Hashim Niane"}),
  ]);
  for (const id of [BIZ, DIRECT_BIZ]) {
    await settings({acceptRequests: true, openingHours: {default: WEEK},
      pickup: {enabled: false, areas: ""}, payNow: true},
    id === BIZ ? OWNER : DIRECT_OWNER, id);
  }
});

describe("the Pay now switch", () => {
  it("is off until the owner turns it on, and is one switch with the " +
    "old card setting", async () => {
    const fresh = await settings({acceptRequests: true,
      openingHours: {default: WEEK}}, OTHER_OWNER, OTHER_BIZ);
    assert.equal(fresh.payNow, false);
    assert.equal(fresh.settings.payNow, false);
    assert.equal(fresh.settings.cardBarrelBooking, false);
    assert.equal(fresh.stripeConnected, false);
    assert.equal(fresh.payNowChargeType, "platform");
    const on = await settings({payNow: true, acceptRequests: true,
      openingHours: {default: WEEK}});
    assert.equal(on.payNow, true);
    assert.equal(on.settings.cardBarrelBooking, true);
    assert.equal((await db.collection("businesses").doc(BIZ).get())
        .data().packageRequestSettings.payNow, true);
    // An older client that only knows the card switch moves both.
    const legacy = await settings({cardBarrelBooking: false,
      acceptRequests: true, openingHours: {default: WEEK}});
    assert.equal(legacy.payNow, false);
    await settings({payNow: true, acceptRequests: true,
      openingHours: {default: WEEK}});
  });

  it("says whether a charge would be direct", async () => {
    const direct = await settings({payNow: true, acceptRequests: true,
      openingHours: {default: WEEK}}, DIRECT_OWNER, DIRECT_BIZ);
    assert.equal(direct.stripeConnected, true);
    assert.equal(direct.payNowChargeType, "direct");
  });

  it("is the owner's: staff and strangers are refused", async () => {
    assert.equal(await reasonOf(settings({payNow: true}, COUNTER)),
        "permission-denied");
    assert.equal(await reasonOf(settings({payNow: true}, OTHER_OWNER)),
        "permission-denied");
  });
});

describe("the pay link", () => {
  it("exists only when the price is exact, and goes out once on " +
    "confirming", async () => {
    whatsapp.calls = [];
    const sent = await call("submitPackageRequest", submission(BIZ,
        {pieces: [{kind: "barrel"}, {kind: "box", description: "Clothes"}]}),
    "anon-pn-exact", ANON);
    // A box with no price: no estimate yet, so no link.
    assert.equal(sent.status, "new");
    assert.equal((await requestDoc(sent.requestId)).payNow, undefined);
    // The business prices it; the customer confirms: now it is exact.
    await staff("sendPackageEstimate", {requestId: sent.requestId,
      baseVersion: 0, pieces: [{id: "p1", cents: 15000},
        {id: "p2", cents: 4500}]}, COUNTER);
    assert.equal((await requestDoc(sent.requestId)).payNow, undefined,
        "not confirmed yet");
    await call("confirmPackageEstimate", {token: sent.token, version: 1});
    const row = await requestDoc(sent.requestId);
    assert.equal(row.payNow.status, "open");
    assert.equal(row.payNow.amountCents, 19500);
    assert.equal(row.payNow.chargeType, "platform");
    assert.equal(row.payNow.connectedAccountId, "");
    assert.equal(row.payNow.linkUrl,
        `https://laawoldigital.com/p?t=${row.payNow.token}`);
    assert.ok(row.payNow.token.length >= 16);
    assert.ok(row.history.some((h) => h.action === "pay_link_ready"));
    // The approved template, with the amount in both languages and the
    // pay token on the button.
    const templates = templatesTo("package_pay_now_2lang");
    assert.equal(templates.length, 1);
    const [body, button] = templates[0].template.components;
    assert.deepEqual(body.parameters.map((p) => p.text), ["Fatou Diallo",
      "Dala Shipping", "$195.00", "Dala Shipping", "195,00 $", row.code]);
    assert.equal(button.parameters[0].text, row.payNow.token);
    assert.equal(row.payNow.messages.length, 1);
    assert.equal(row.payNow.messages[0].ok, true);
    assert.equal(row.payNow.messages[0].channel, "template");
    assert.equal(row.payNow.messages[0].amountCents, 19500);
    // A second confirm of the same estimate sends nothing more.
    await call("confirmPackageEstimate", {token: sent.token, version: 1});
    assert.equal(templatesTo("package_pay_now_2lang").length, 1);
  });

  it("shows the customer a subset, never the Stripe ids or the account",
      async () => {
        const {token, request} = await confirmedRequest();
        const page = await call("getPackageRequestByToken", {token});
        assert.deepEqual(page.request.payNow, {status: "open",
          amountCents: 15000, linkUrl: request.payNow.linkUrl, paidCents: 0,
          refundedCents: 0, balanceDueCents: 0});
        const shown = JSON.stringify(page);
        for (const secret of ["paymentIntentId", "chargeId",
          "connectedAccountId", "checkoutSessionId", "stripeFeeCents"]) {
          assert.equal(shown.includes(secret), false, secret);
        }
      });

  it("is not made while the switch is off, and a request without a link " +
    "answers null", async () => {
    await settings({payNow: false, acceptRequests: true,
      openingHours: {default: WEEK}});
    try {
      const {token, requestId} = await confirmedRequest();
      assert.equal((await requestDoc(requestId)).payNow, undefined);
      assert.equal((await call("getPackageRequestByToken", {token}))
          .request.payNow, null);
      // Turning it on later makes the link on Resend.
      await settings({payNow: true, acceptRequests: true,
        openingHours: {default: WEEK}});
      const resent = await staff("setPackageRequestSettings",
          {action: "pay_resend", requestId}, OWNER);
      assert.equal(resent.payNow.status, "open");
    } finally {
      await settings({payNow: true, acceptRequests: true,
        openingHours: {default: WEEK}});
    }
  });

  it("is not made while a piece waits for the counter's scale", async () => {
    const {requestId} = await confirmedRequest();
    // The price list priced a box per pound; the scale decides at the
    // counter. (Stored as the price list writes it.)
    await db.collection("packageRequests").doc(requestId).update({
      pieces: [{id: "p1", kind: "box", estimateCents: 4000,
        price: {source: "per_lb", perLbCents: 400, weightLb: 10}}],
      "estimate.auto": true, payNow: admin.firestore.FieldValue.delete()});
    assert.equal(await reasonOf(staff("setPackageRequestSettings",
        {action: "pay_resend", requestId})), "pay_not_open");
  });

  it("falls back to a button message inside the 24 hours when the " +
    "template is not approved yet", async () => {
    whatsapp.mode = "template_missing";
    whatsapp.calls = [];
    try {
      const phone = freshPhone();
      await db.collection("whatsappContacts")
          .doc(phone.replace(/\D/g, "")).set({
            phone: phone.replace(/\D/g, ""), lastInboundAtMs: Date.now() -
              3600 * 1000});
      const sent = await call("submitPackageRequest", submission(BIZ,
          {sender: {name: "Fatou Diallo", phoneE164: phone}}),
      "anon-pn-fallback", ANON);
      await call("confirmPackageEstimate", {token: sent.token, version: 1});
      const row = await requestDoc(sent.requestId);
      assert.deepEqual(row.payNow.messages.map((m) => [m.channel, m.ok]),
          [["template", false], ["session", true]]);
      const session = whatsapp.calls.find((c) => c.type === "interactive");
      assert.equal(session.interactive.type, "cta_url");
      assert.equal(session.interactive.action.parameters.url,
          row.payNow.linkUrl);
      assert.equal(row.status, "confirmed", "the flow was not disturbed");
    } finally {
      whatsapp.mode = "ok";
    }
  });

  it("records a failed send and never fails the customer's confirm",
      async () => {
        whatsapp.mode = "template_missing";
        try {
          // No contact window: only the request page shows the button.
          const {requestId} = await confirmedRequest();
          const row = await requestDoc(requestId);
          assert.equal(row.status, "confirmed");
          assert.equal(row.payNow.status, "open");
          assert.equal(row.payNow.messages.length, 1);
          assert.equal(row.payNow.messages[0].ok, false);
          assert.match(row.payNow.messages[0].error, /Template/);
        } finally {
          whatsapp.mode = "ok";
        }
      });

  it("is resent by staff, on the same link", async () => {
    const {requestId, request} = await confirmedRequest();
    whatsapp.calls = [];
    const resent = await staff("setPackageRequestSettings",
        {action: "pay_resend", requestId}, COUNTER);
    assert.equal(resent.success, true);
    assert.equal(resent.payNow.token, request.payNow.token);
    assert.equal(templatesTo("package_pay_now_2lang").length, 1);
    assert.equal(resent.payNow.messages.length, 2);
    assert.equal(await reasonOf(staff("setPackageRequestSettings",
        {action: "pay_resend", requestId}, OTHER_OWNER)), "not_allowed");
    assert.equal(await reasonOf(staff("setPackageRequestSettings",
        {action: "pay_resend", requestId: "nope"}, COUNTER)), "pay_not_found");
  });

  it("closes with the request if nobody paid", async () => {
    const {requestId} = await confirmedRequest();
    await staff("cancelPackageRequest", {requestId, reason: "changed mind"},
        COUNTER);
    const row = await requestDoc(requestId);
    assert.equal(row.status, "cancelled");
    assert.equal(row.payNow.status, "cancelled");
    const visited = await visit(row.payNow.token);
    assert.equal(visited.status, 200);
    assert.match(visited.body, /Link cancelled/);
  });
});

describe("the link opens Stripe", () => {
  it("mints a session for a platform charge, reuses it, and mints a new " +
    "one when it is spent", async () => {
    const {requestId, code, request} = await confirmedRequest();
    stripe.calls = [];
    const first = await visit(request.payNow.token);
    assert.equal(first.status, 303);
    assert.match(first.redirect, /^https:\/\/checkout\.stripe\.test\/cs_test_/);
    const [create] = stripeCalls("POST", "/checkout/sessions");
    assert.equal(create.headers["Stripe-Account"], undefined,
        "a platform charge");
    assert.equal(create.body["line_items[0][price_data][unit_amount]"],
        "15000");
    assert.equal(create.body["line_items[0][price_data][product_data][name]"],
        `Dala Shipping shipment ${code}`);
    assert.equal(create.body["metadata[paymentType]"], "package_request_pay");
    assert.equal(create.body["metadata[requestId]"], requestId);
    assert.equal(create.body["metadata[businessId]"], BIZ);
    assert.equal(create.body["metadata[code]"], code);
    assert.equal(create.body["payment_intent_data[metadata][paymentType]"],
        "package_request_pay");
    assert.equal(create.body["payment_intent_data[application_fee_amount]"],
        undefined, "no application fee");
    assert.equal(create.headers["Idempotency-Key"].length > 0, true);
    assert.match(create.body.success_url, /\/e\/.+\?paid=1$/);
    const stored = await requestDoc(requestId);
    assert.equal(stored.payNow.mintCount, 1);
    assert.equal(stored.payNow.checkoutSessionId.startsWith("cs_test_"), true);
    // The same visit again: the open session, no new one.
    const again = await visit(request.payNow.token);
    assert.equal(again.redirect, first.redirect);
    assert.equal(stripeCalls("POST", "/checkout/sessions").length, 1);
    // The session is spent (24 hours): the link mints a fresh one.
    stripe.sessions.get(stored.payNow.checkoutSessionId).status = "expired";
    const fresh = await visit(request.payNow.token);
    assert.notEqual(fresh.redirect, first.redirect);
    assert.equal(stripeCalls("POST", "/checkout/sessions").length, 2);
    assert.equal((await requestDoc(requestId)).payNow.mintCount, 2);
  });

  it("charges on the business's own account when it has Stripe", async () => {
    const {request} = await confirmedRequest(DIRECT_BIZ);
    assert.equal(request.payNow.chargeType, "direct");
    assert.equal(request.payNow.connectedAccountId, DIRECT_ACCOUNT);
    stripe.calls = [];
    await visit(request.payNow.token);
    const [create] = stripeCalls("POST", "/checkout/sessions");
    assert.equal(create.headers["Stripe-Account"], DIRECT_ACCOUNT);
    assert.equal(create.body["payment_intent_data[application_fee_amount]"],
        undefined);
  });

  it("answers an unknown token as not found, and a spent link plainly",
      async () => {
        assert.equal((await visit("x".repeat(40))).status, 404);
        assert.equal((await visit("short")).status, 404);
      });

  it("uses today's price: a price that stopped being exact is not " +
    "payable", async () => {
    const {requestId, request} = await confirmedRequest();
    await db.collection("packageRequests").doc(requestId).update({
      pieces: [{id: "p1", kind: "box", estimateCents: 4000,
        price: {source: "per_lb", perLbCents: 400, weightLb: 10}}]});
    const visited = await visit(request.payNow.token);
    assert.equal(visited.status, 200);
    assert.match(visited.body, /cannot be paid online/);
    const page = await call("getPackageRequestByToken",
        {token: request.token});
    assert.equal(page.request.payNow.linkUrl, "");
  });
});

describe("the webhook", () => {
  it("marks a platform charge paid, with the fee and the ledger rows",
      async () => {
        const {requestId, token, request} = await confirmedRequest();
        await visit(request.payNow.token);
        const {intent, sent} = await customerPays(requestId);
        assert.equal(sent.status, 200);
        const row = await requestDoc(requestId);
        const fee = feeFor(15000);
        assert.equal(row.payNow.status, "paid");
        assert.equal(row.payNow.paidCents, 15000);
        assert.equal(row.payNow.stripeFeeCents, fee);
        assert.equal(row.payNow.paymentIntentId, intent.id);
        assert.equal(row.payNow.chargeId, intent.latest_charge);
        assert.equal(row.payNow.chargeType, "platform");
        assert.equal(row.payNow.refundedCents, 0);
        assert.ok(row.payNow.paidAtMs > 0);
        assert.ok(row.history.some((h) => h.action === "paid_online" &&
          h.totalCents === 15000));
        const ledger = await ledgerFor(requestId);
        assert.deepEqual(ledger.map((r) => [r.type, r.amountCents]),
            [["stripe_fee", -fee], ["payment", 15000]]);
        assert.ok(ledger.every((r) => r.businessId === BIZ &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.weekKey)));
        const page = await call("getPackageRequestByToken", {token});
        assert.equal(page.request.payNow.status, "paid");
        assert.equal(page.request.payNow.paidCents, 15000);
        assert.equal(page.request.payNow.linkUrl, "");
        const visited = await visit(request.payNow.token);
        assert.match(visited.body, /Already paid/);
      });

  it("settles a payment once, however many events say so", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    const paid = await customerPays(requestId);
    const first = await requestDoc(requestId);
    // The very same event again (Stripe redelivers).
    assert.ok(paid.event.id);
    const replay = await deliver(paid.event);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    // And the PaymentIntent's own event, a different event id.
    const second = await deliver({type: "payment_intent.succeeded",
      data: {object: paid.intent}});
    assert.equal(second.status, 200);
    const after = await requestDoc(requestId);
    assert.equal(after.payNow.paidAtMs, first.payNow.paidAtMs);
    assert.equal(after.history.filter((h) => h.action === "paid_online")
        .length, 1);
    assert.equal((await ledgerFor(requestId)).length, 2);
  });

  it("marks a direct charge paid and writes no ledger rows", async () => {
    const {requestId, request} = await confirmedRequest(DIRECT_BIZ);
    await visit(request.payNow.token);
    const {sent} = await customerPays(requestId);
    assert.equal(sent.status, 200);
    const row = await requestDoc(requestId);
    assert.equal(row.payNow.status, "paid");
    assert.equal(row.payNow.chargeType, "direct");
    assert.equal(row.payNow.connectedAccountId, DIRECT_ACCOUNT);
    assert.equal(row.payNow.stripeFeeCents, feeFor(15000));
    assert.deepEqual(await ledgerFor(requestId), []);
    // The fee lookups went to the connected account.
    const charge = stripe.calls.filter((c) => c.path.startsWith("/charges/"))
        .pop();
    assert.equal(charge.headers["Stripe-Account"], DIRECT_ACCOUNT);
  });

  it("refunds a second payment on a paid request", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    await customerPays(requestId);
    // A second session of the same link is paid too (opened twice).
    const dup = {id: "pi_dup_1", status: "succeeded", amount: 15000,
      amount_received: 15000, latest_charge: "ch_dup_1",
      metadata: {paymentType: "package_request_pay", requestId,
        businessId: BIZ, code: request.code}};
    stripe.intents.set(dup.id, dup);
    stripe.calls = [];
    const sent = await deliver({type: "payment_intent.succeeded",
      data: {object: dup}});
    assert.equal(sent.status, 200);
    const refund = stripeCalls("POST", "/refunds");
    assert.equal(refund.length, 1);
    assert.equal(refund[0].body.payment_intent, "pi_dup_1");
    assert.equal(refund[0].body.amount, "15000");
    const row = await requestDoc(requestId);
    assert.notEqual(row.payNow.paymentIntentId, "pi_dup_1");
    assert.equal((await ledgerFor(requestId)).length, 2);
  });

  it("ignores another business's metadata and strangers' events", async () => {
    const {requestId} = await confirmedRequest();
    const intent = {id: "pi_wrong_biz", status: "succeeded", amount: 15000,
      amount_received: 15000, latest_charge: "ch_wrong_biz",
      metadata: {paymentType: "package_request_pay", requestId,
        businessId: OTHER_BIZ}};
    stripe.intents.set(intent.id, intent);
    await deliver({type: "payment_intent.succeeded",
      data: {object: intent}});
    assert.equal((await requestDoc(requestId)).payNow.status, "open");
    assert.equal((await ledgerFor(requestId)).length, 0);
    // An event of another payment type goes on to the generic path.
    const other = await deliver({type: "payment_intent.succeeded",
      data: {object: {id: "pi_other", status: "succeeded", metadata: {}}}});
    assert.equal(other.status, 200);
  });

  it("keeps the link good when a session expires or a card fails",
      async () => {
        const {requestId, request} = await confirmedRequest();
        await visit(request.payNow.token);
        const session = [...stripe.sessions.values()].find((s) =>
          s.metadata.requestId === requestId);
        const sent = await deliver({type: "checkout.session.expired",
          data: {object: {...session, status: "expired"}}});
        assert.equal(sent.status, 200);
        assert.equal((await requestDoc(requestId)).payNow.status, "open");
        assert.equal((await visit(request.payNow.token)).status, 303);
      });

  it("pays through the link's own check if the webhook is late", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    await customerPays(requestId, {event: false});
    assert.equal((await requestDoc(requestId)).payNow.status, "open");
    const visited = await visit(request.payNow.token);
    assert.match(visited.body, /Already paid/);
    assert.equal((await requestDoc(requestId)).payNow.status, "paid");
    assert.equal((await ledgerFor(requestId)).length, 2);
  });

  it("turns a dispute into a chargeback and the $15 fee, once; a win " +
    "puts the money back", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    const {intent} = await customerPays(requestId);
    const dispute = {id: "dp_1", amount: 15000, charge: intent.latest_charge,
      payment_intent: intent.id, status: "needs_response"};
    await deliver({type: "charge.dispute.created", data: {object: dispute}});
    await deliver({type: "charge.dispute.created", data: {object: dispute}});
    const ledger = await ledgerFor(requestId);
    const sum = (type) => ledger.filter((r) => r.type === type)
        .reduce((total, r) => total + r.amountCents, 0);
    assert.equal(sum("chargeback"), -15000);
    assert.equal(sum("dispute_fee"), -1500);
    const row = await requestDoc(requestId);
    assert.equal(row.payNow.disputes.length, 1);
    assert.ok(row.history.some((h) => h.action === "dispute_opened"));
    await deliver({type: "charge.dispute.closed",
      data: {object: {...dispute, status: "won"}}});
    const after = await ledgerFor(requestId);
    assert.equal(after.filter((r) => r.type === "chargeback")
        .reduce((total, r) => total + r.amountCents, 0), 0);
  });

  it("leaves a dispute on a direct charge to the business's Stripe",
      async () => {
        const {requestId, request} = await confirmedRequest(DIRECT_BIZ);
        await visit(request.payNow.token);
        const {intent} = await customerPays(requestId);
        await deliver({type: "charge.dispute.created", account:
          DIRECT_ACCOUNT, data: {object: {id: "dp_direct", amount: 15000,
          charge: intent.latest_charge, payment_intent: intent.id}}});
        assert.deepEqual(await ledgerFor(requestId), []);
        assert.equal((await requestDoc(requestId)).payNow.disputes.length, 1);
      });
});

describe("refunds", () => {
  it("are refused for the wrong amount, the wrong person, or no payment",
      async () => {
        const {requestId, request} = await confirmedRequest();
        const refund = (data, uid = OWNER) => staff(
            "setPackageRequestSettings",
            {action: "pay_refund", requestId, ...data}, uid);
        stripe.calls = [];
        assert.equal(await reasonOf(refund({amountCents: 100})),
            "pay_not_paid");
        await visit(request.payNow.token);
        await customerPays(requestId);
        assert.equal(await reasonOf(refund({amountCents: 15001})),
            "refund_too_much");
        for (const amountCents of [0, -1, 1.5, "100", null]) {
          assert.equal(await reasonOf(refund({amountCents})),
              "refund_invalid", String(amountCents));
        }
        // Staff with only the containers permission may not refund.
        assert.equal(await reasonOf(refund({amountCents: 100}, COUNTER)),
            "not_allowed");
        assert.equal(await reasonOf(refund({amountCents: 100}, OTHER_OWNER)),
            "not_allowed");
        assert.equal(stripeCalls("POST", "/refunds").length, 0,
            "nothing reached Stripe");
        const row = await requestDoc(requestId);
        assert.equal(row.payNow.refundedCents, 0);
        assert.equal(row.payNow.status, "paid");
      });

  it("take part and then the rest on a platform charge: the card at " +
    "once, a ledger line each", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    const {intent} = await customerPays(requestId);
    stripe.calls = [];
    const refund = (amountCents, uid = LEDGER_STAFF) => staff(
        "setPackageRequestSettings",
        {action: "pay_refund", requestId, amountCents,
          reason: "Box arrived damaged"}, uid);
    const first = await refund(4000);
    assert.equal(first.success, true);
    assert.equal(first.payNow.status, "partly_refunded");
    assert.equal(first.payNow.refundedCents, 4000);
    assert.equal(first.payNow.refunds[0].byUid, LEDGER_STAFF);
    assert.equal(first.payNow.refunds[0].reason, "Box arrived damaged");
    const [stripeRefund] = stripeCalls("POST", "/refunds");
    assert.equal(stripeRefund.body.payment_intent, intent.id);
    assert.equal(stripeRefund.body.amount, "4000");
    assert.equal(stripeRefund.headers["Stripe-Account"], undefined);
    assert.equal(await reasonOf(refund(11001)), "refund_too_much");
    const second = await refund(11000, OWNER);
    assert.equal(second.payNow.status, "refunded");
    assert.equal(second.payNow.refundedCents, 15000);
    assert.equal(await reasonOf(refund(1)), "pay_not_paid");
    const ledger = await ledgerFor(requestId);
    const refunds = ledger.filter((r) => r.type === "refund");
    assert.deepEqual(refunds.map((r) => r.amountCents).sort((a, b) => a - b),
        [-11000, -4000]);
    assert.ok(refunds.every((r) => r.businessId === BIZ));
    // Stripe keeps its fee: the business is out the fee after a full refund.
    assert.equal(ledger.reduce((total, r) => total + r.amountCents, 0),
        -feeFor(15000));
    const row = await requestDoc(requestId);
    assert.equal(row.history.filter((h) => h.action === "refunded_online")
        .length, 2);
    // The customer was told on WhatsApp (outside the window: recorded).
    assert.ok(row.payNow.messages.some((m) => m.kind === "refund"));
  });

  it("go to the business's own Stripe account on a direct charge, with " +
    "no ledger line", async () => {
    const {requestId, request} = await confirmedRequest(DIRECT_BIZ);
    await visit(request.payNow.token);
    await customerPays(requestId);
    stripe.calls = [];
    const answer = await staff("setPackageRequestSettings",
        {action: "pay_refund", requestId, amountCents: 5000},
        DIRECT_OWNER, DIRECT_BIZ);
    assert.equal(answer.payNow.status, "partly_refunded");
    const [stripeRefund] = stripeCalls("POST", "/refunds");
    assert.equal(stripeRefund.headers["Stripe-Account"], DIRECT_ACCOUNT);
    assert.deepEqual((await ledgerFor(requestId)).filter((r) =>
      r.type === "refund"), []);
  });

  it("are not recorded when Stripe refuses them", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    await customerPays(requestId);
    stripe.failRefund = true;
    try {
      await assert.rejects(staff("setPackageRequestSettings",
          {action: "pay_refund", requestId, amountCents: 100}));
    } finally {
      stripe.failRefund = false;
    }
    const row = await requestDoc(requestId);
    assert.equal(row.payNow.refundedCents, 0);
    assert.equal((await ledgerFor(requestId)).filter((r) =>
      r.type === "refund").length, 0);
  });

  it("tell the staff when the price goes down after paying, and what " +
    "is still owed when it goes up", async () => {
    const {requestId, request} = await confirmedRequest(BIZ, 2);
    await visit(request.payNow.token);
    await customerPays(requestId);
    assert.equal((await requestDoc(requestId)).payNow.paidCents, 30000);
    // The business corrects the price down by $20 (a person's estimate).
    const down = await staff("sendPackageEstimate", {requestId,
      baseVersion: 1, pieces: [{id: "p1", cents: 14000},
        {id: "p2", cents: 14000}]}, COUNTER);
    assert.equal(down.totalCents, 28000);
    const row = await requestDoc(requestId);
    assert.equal(row.payNow.status, "paid", "one charge only");
    assert.equal(row.payNow.refundDueCents, 2000);
    assert.equal(row.payNow.balanceDueCents, 0);
  });
});

describe("Received", () => {
  it("records the online payment on the line and does not charge it " +
    "again", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    await customerPays(requestId);
    // The counter cannot take money that was already paid.
    assert.equal(await reasonOf(staff("receivePackageRequest", {requestId,
      pieces: [{id: "p1"}], payment: {amountCents: 100, method: "cash",
        receivedByStaffId: COUNTER}}, COUNTER)), "payment_exceeds_balance");
    const received = await staff("receivePackageRequest", {requestId,
      pieces: [{id: "p1"}]}, COUNTER);
    assert.equal(received.paidCents, 15000);
    assert.equal(received.alreadyReceived, false);
    const line = (await db.collection("containerLines")
        .doc(received.lineId).get()).data();
    assert.equal(line.priceCents, 15000);
    assert.equal(line.paidCents, 15000);
    const payments = await db.collection("containerLinePayments")
        .where("businessId", "==", BIZ)
        .where("lineId", "==", received.lineId).get();
    assert.equal(payments.size, 1);
    const payment = payments.docs[0].data();
    assert.equal(payment.amountCents, 15000);
    assert.equal(payment.method, "card_online");
    assert.equal(payment.source, "card_order");
    assert.equal(payment.reverted, false);
    const row = await requestDoc(requestId);
    assert.equal(row.status, "received");
    assert.equal(row.payNow.linePaymentId, payments.docs[0].id);
    assert.equal(row.payNow.status, "paid");
    // A refund after Received takes the credit back off the line.
    await staff("setPackageRequestSettings", {action: "pay_refund",
      requestId, amountCents: 5000}, OWNER);
    const refunded = (await db.collection("containerLines")
        .doc(received.lineId).get()).data();
    assert.equal(refunded.paidCents, 10000);
    assert.equal((await db.collection("containerLinePayments")
        .doc(payments.docs[0].id).get()).data().amountCents, 10000);
  });

  it("credits only what is left after a refund, and the counter takes " +
    "the rest", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    await customerPays(requestId);
    await staff("setPackageRequestSettings", {action: "pay_refund",
      requestId, amountCents: 6000}, OWNER);
    const received = await staff("receivePackageRequest", {requestId,
      pieces: [{id: "p1"}], payment: {amountCents: 6000, method: "cash",
        receivedByStaffId: COUNTER}}, COUNTER);
    assert.equal(received.paidCents, 15000, "9,000 online + 6,000 cash");
    const payments = await db.collection("containerLinePayments")
        .where("businessId", "==", BIZ)
        .where("lineId", "==", received.lineId).get();
    assert.deepEqual(payments.docs.map((d) => [d.data().method,
      d.data().amountCents]).sort(), [["card_online", 9000], ["cash", 6000]]);
  });

  it("closes an unpaid link when the counter takes the money", async () => {
    const {requestId} = await confirmedRequest();
    const received = await staff("receivePackageRequest", {requestId,
      pieces: [{id: "p1"}]}, COUNTER);
    assert.equal(received.paidCents, 0);
    assert.equal((await requestDoc(requestId)).payNow.status, "cancelled");
  });
});

// ---- The weekly payouts ---------------------------------------------------

// Finished weeks, counted back from this week so they stay inside the
// "all businesses" window whenever the suite runs.
const THIS_WEEK = pay.weekKeyFor(Date.now());
const PAST_A = pay.addDays(THIS_WEEK, -21);
const PAST_B = pay.addDays(THIS_WEEK, -14);
const PAST_C = pay.addDays(THIS_WEEK, -7);
const PAST_D = pay.addDays(THIS_WEEK, -28);

async function seedLedger(businessId, weekKey, rows) {
  await Promise.all(rows.map(([type, amountCents], index) =>
    db.collection("payNowLedger").doc(`${businessId}_${weekKey}_${index}`)
        .set({businessId, requestId: `seed-${weekKey}-${index}`,
          requestCode: `R-SEED${index}`, type, amountCents, weekKey,
          atMs: Date.parse(`${weekKey}T15:00:00Z`) + index, byUid: "",
          byName: "", note: ""})));
}

const payouts = (data, uid = SUPER) => call("setPackageRequestSettings",
    {action: "payouts", ...data}, uid);
const paidOut = (data, uid = SUPER) => call("setPackageRequestSettings",
    {action: "payout_paid", businessId: PAYOUT_BIZ, method: "zelle",
      reference: "ZEL-1", ...data}, uid);

describe("the weekly payouts", () => {
  before(async () => {
    await seedLedger(PAYOUT_BIZ, PAST_A, [["payment", 20000],
      ["stripe_fee", -610], ["payment", 5000], ["stripe_fee", -175],
      ["refund", -2000]]);
    // A closed month of the Laawol bill, $50 unpaid.
    await db.collection("billingMonths").doc(`${PAYOUT_BIZ}_2025-12`).set({
      businessId: PAYOUT_BIZ, month: "2025-12", status: "closed",
      amountCents: 5000, paidCents: 0, unpaidCents: 5000, paymentCount: 0});
  });

  it("show a business its own weeks with the arithmetic and the lines",
      async () => {
        const answer = await payouts({businessId: PAYOUT_BIZ}, PAYOUT_OWNER);
        assert.equal(answer.success, true);
        assert.equal(answer.unpaidBillCents, 5000);
        const week = answer.weeks.find((w) => w.weekKey === PAST_A);
        assert.equal(week.status, "due");
        assert.equal(week.businessName, "Payout Shipping");
        assert.equal(week.collectedCents, 25000);
        assert.equal(week.feesCents, 785);
        assert.equal(week.refundsCents, 2000);
        assert.equal(week.chargebacksCents, 0);
        assert.equal(week.billOffsetCents, 5000);
        assert.equal(week.netCents, 17215);
        assert.equal(week.payoutCents, 17215);
        assert.equal(week.payoutKey, pay.addDays(PAST_A, 7));
        assert.equal(week.lines.length, 5);
      });

  it("show Laawol every business, and refuse everyone else", async () => {
    const all = await payouts({}, FINANCE);
    assert.ok(all.weeks.some((w) => w.businessId === PAYOUT_BIZ));
    assert.equal(all.unpaidBillByBusiness[PAYOUT_BIZ], 5000);
    assert.equal(await reasonOf(payouts({}, PAYOUT_OWNER)), "not_allowed");
    assert.equal(await reasonOf(payouts({businessId: PAYOUT_BIZ},
        OTHER_OWNER)), "not_allowed");
    assert.equal(await reasonOf(payouts({businessId: PAYOUT_BIZ}, COUNTER)),
        "not_allowed");
  });

  it("are marked paid by a super admin only", async () => {
    assert.equal(await reasonOf(paidOut({weekKey: PAST_A}, FINANCE)),
        "not_allowed");
    assert.equal(await reasonOf(paidOut({weekKey: PAST_A}, PAYOUT_OWNER)),
        "not_allowed");
    assert.equal(await reasonOf(paidOut({weekKey: pay.addDays(PAST_A, 1)})),
        "week_invalid");
    assert.equal(await reasonOf(paidOut({weekKey: PAST_A, method: "cash"})),
        "method_invalid");
    assert.equal(await reasonOf(paidOut({weekKey: PAST_A,
      reference: "x".repeat(200)})), "reference_too_long");
    assert.equal(await reasonOf(paidOut({weekKey: THIS_WEEK})),
        "week_not_over");
    assert.equal(await reasonOf(paidOut({weekKey: PAST_C})), "week_empty");
    assert.equal(await reasonOf(paidOut({businessId: ""})),
        "business_required");
  });

  it("take the unpaid Laawol bill out, record the payout, and tell the " +
    "owner", async () => {
    whatsapp.calls = [];
    const done = await paidOut({weekKey: PAST_A});
    assert.equal(done.success, true);
    assert.equal(done.payout.status, "paid");
    assert.equal(done.payout.collectedCents, 25000);
    assert.equal(done.payout.feesCents, 785);
    assert.equal(done.payout.refundsCents, 2000);
    assert.equal(done.payout.billOffsetCents, 5000);
    assert.equal(done.payout.netCents, 17215);
    assert.equal(done.payout.payoutCents, 17215);
    assert.equal(done.payout.method, "zelle");
    assert.equal(done.payout.reference, "ZEL-1");
    assert.equal(done.payout.paidByName, "Hashim Niane");
    assert.equal(done.receiptSent, true);
    // The bill: one payment, method pay_now_offset, month paid.
    const payments = await db.collection("billingPayments")
        .where("businessId", "==", PAYOUT_BIZ).get();
    assert.equal(payments.size, 1);
    assert.equal(payments.docs[0].data().method, "pay_now_offset");
    assert.equal(payments.docs[0].data().amountCents, 5000);
    assert.equal(payments.docs[0].data().month, "2025-12");
    assert.equal(payments.docs[0].data().voided, false);
    const month = (await db.collection("billingMonths")
        .doc(`${PAYOUT_BIZ}_2025-12`).get()).data();
    assert.equal(month.paidCents, 5000);
    assert.equal(month.unpaidCents, 0);
    assert.equal(month.paymentCount, 1);
    // The ledger and the payout record.
    const rows = (await db.collection("payNowLedger")
        .where("businessId", "==", PAYOUT_BIZ)
        .where("weekKey", "==", PAST_A).get()).docs.map((d) => d.data());
    assert.deepEqual(rows.filter((r) => r.type === "bill_offset")
        .map((r) => r.amountCents), [-5000]);
    assert.deepEqual(rows.filter((r) => r.type === "payout")
        .map((r) => [r.amountCents, r.byName]), [[-17215, "Hashim Niane"]]);
    const stored = (await db.collection("payNowPayouts")
        .doc(`${PAYOUT_BIZ}_${PAST_A}`).get()).data();
    assert.equal(stored.status, "paid");
    assert.equal(stored.receiptSent, true);
    // The receipt: the approved template, amounts in both languages.
    const [receipt] = templatesTo("pay_now_payout_2lang");
    assert.deepEqual(receipt.template.components[0].parameters.map((p) =>
      p.text), ["Alhoussaine", "$172.15", pay.dateText(PAST_A, "en"),
      "172,15 $", pay.dateText(PAST_A, "fr"), "Zelle"]);
    assert.equal(receipt.to, "16465550101");
    // The audit trail.
    const audit = await db.collection("adminAuditLogs")
        .where("action", "==", "pay_now_payout_paid").get();
    assert.ok(audit.docs.some((d) => d.data().targetId ===
      `${PAYOUT_BIZ}_${PAST_A}`));
    // The same week twice is refused; the owner now sees it paid.
    assert.equal(await reasonOf(paidOut({weekKey: PAST_A})),
        "week_already_paid");
    const after = await payouts({businessId: PAYOUT_BIZ}, PAYOUT_OWNER);
    assert.equal(after.unpaidBillCents, 0);
    const week = after.weeks.find((w) => w.weekKey === PAST_A);
    assert.equal(week.status, "paid");
    assert.equal(week.payoutCents, 17215);
    assert.equal(week.method, "zelle");
    assert.ok(week.lines.some((l) => l.type === "payout"));
  });

  it("put a negative week on the Laawol bill, and take it from the next " +
    "payout", async () => {
    // A week of one payment, then refunded: the fee is all Laawol owes
    // back, and a $15 dispute fee besides.
    await seedLedger(PAYOUT_BIZ, PAST_B, [["payment", 1000],
      ["stripe_fee", -59], ["refund", -1000], ["dispute_fee", -1500]]);
    await seedLedger(PAYOUT_BIZ, PAST_C, [["payment", 10000],
      ["stripe_fee", -320]]);
    const negative = await paidOut({weekKey: PAST_B, method: ""});
    assert.equal(negative.payout.status, "paid");
    assert.equal(negative.payout.toBillCents, 1559);
    assert.equal(negative.payout.netCents, -1559);
    assert.equal(negative.payout.payoutCents, 0);
    assert.equal(negative.payout.method, "");
    assert.equal(negative.receiptSent, false);
    const rows = (await db.collection("payNowLedger")
        .where("businessId", "==", PAYOUT_BIZ)
        .where("weekKey", "==", PAST_B).get()).docs.map((d) => d.data());
    assert.deepEqual(rows.filter((r) => r.type === "to_bill")
        .map((r) => r.amountCents), [1559]);
    assert.equal(rows.filter((r) => r.type === "payout").length, 0);
    const adjustment = (await db.collection("billingAdjustments")
        .doc(`${PAYOUT_BIZ}_${PAST_B}`).get()).data();
    assert.equal(adjustment.amountCents, 1559);
    assert.equal(adjustment.outstandingCents, 1559);
    assert.equal(adjustment.reason, "pay_now_negative_week");
    // The bill now carries it, and the owner sees it.
    const mid = await payouts({businessId: PAYOUT_BIZ}, PAYOUT_OWNER);
    assert.equal(mid.unpaidBillCents, 1559);
    const next = mid.weeks.find((w) => w.weekKey === PAST_C);
    assert.equal(next.billOffsetCents, 1559);
    assert.equal(next.payoutCents, 10000 - 320 - 1559);
    // The next payout takes it out.
    const done = await paidOut({weekKey: PAST_C});
    assert.equal(done.payout.billOffsetCents, 1559);
    assert.equal(done.payout.payoutCents, 8121);
    const settled = (await db.collection("billingAdjustments")
        .doc(`${PAYOUT_BIZ}_${PAST_B}`).get()).data();
    assert.equal(settled.outstandingCents, 0);
    assert.equal(settled.settledCents, 1559);
    assert.equal((await payouts({businessId: PAYOUT_BIZ}, PAYOUT_OWNER))
        .unpaidBillCents, 0);
  });

  it("never take more of a week than it brought", async () => {
    const week = PAST_D;
    await seedLedger(PAYOUT_BIZ, week, [["payment", 3000],
      ["stripe_fee", -117]]);
    await db.collection("billingMonths").doc(`${PAYOUT_BIZ}_2026-01`).set({
      businessId: PAYOUT_BIZ, month: "2026-01", status: "closed",
      amountCents: 20000, paidCents: 0, unpaidCents: 20000,
      paymentCount: 0});
    const done = await paidOut({weekKey: week, method: ""});
    assert.equal(done.payout.billOffsetCents, 2883);
    assert.equal(done.payout.payoutCents, 0);
    assert.equal(done.payout.netCents, 0);
    assert.equal(done.receiptSent, false);
    const month = (await db.collection("billingMonths")
        .doc(`${PAYOUT_BIZ}_2026-01`).get()).data();
    assert.equal(month.unpaidCents, 17117);
  });

  it("moves a late payment's rows into the current week when its own " +
    "week was already paid", async () => {
    const {requestId, request} = await confirmedRequest();
    await visit(request.payNow.token);
    // The charge happened in PAST_A's week, which was paid out above.
    stripe.chargedAtMs = Date.parse(`${PAST_A}T15:00:00Z`);
    await db.collection("payNowPayouts").doc(`${BIZ}_${PAST_A}`).set({
      businessId: BIZ, weekKey: PAST_A, status: "paid"});
    try {
      await customerPays(requestId);
      const ledger = await ledgerFor(requestId);
      assert.equal(ledger.length, 2);
      assert.ok(ledger.every((r) => r.weekKey === THIS_WEEK),
          "a paid week never changes: the rows wait in this week");
      assert.equal((await requestDoc(requestId)).payNow.paidAtMs,
          stripe.chargedAtMs);
    } finally {
      stripe.chargedAtMs = 0;
    }
  });
});
