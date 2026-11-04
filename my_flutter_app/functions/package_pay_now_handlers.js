"use strict";

/**
 * Pay now on package requests, the Firestore / Stripe / WhatsApp glue
 * (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §3). The rules are pure in
 * package_pay_now.js; index.js wires this once and calls it from the existing
 * callables and endpoints - it adds no function of its own:
 *
 *   syncRequest        after a request is confirmed, re-priced, closed
 *   resolveLink        the /p?t= link (parkingPaymentLink's third resolver)
 *   handleStripeEvent  the Stripe webhook (paid, disputes)
 *   handleAction       setPackageRequestSettings' pay_refund, pay_resend,
 *                      payouts and payout_paid actions
 *   receiveCredit      what Received records on the line
 */

const crypto = require("node:crypto");
const pay = require("./package_pay_now");
const {withinWindow} = require("./whatsapp_inbox");

const REQUESTS = "packageRequests";
const LEDGER = "payNowLedger";
const PAYOUTS = "payNowPayouts";
const BILLING_MONTHS = "billingMonths";
const BILLING_PAYMENTS = "billingPayments";
const BILLING_ADJUSTMENTS = "billingAdjustments";
const LINE_PAYMENTS = "containerLinePayments";

const PAID_STATES = Object.freeze([pay.STATUS.PAID,
  pay.STATUS.PARTLY_REFUNDED, pay.STATUS.REFUNDED]);
const ACTIONS = Object.freeze(["pay_refund", "pay_resend", "payouts",
  "payout_paid"]);
const OFFSET_METHOD = "pay_now_offset";
const MAX_BILL_PAYMENTS_PER_MONTH = 200;
const LEDGER_PAGE = 3000;
const ALL_BUSINESSES_WEEKS = 26;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/**
 * @param {object} deps What index.js hands in (see the call there).
 * @return {object} The handlers.
 */
function createPackagePayNowHandlers(deps) {
  const {admin, logger, HttpsError, FieldValue, stripe} = deps;
  const db = () => admin.firestore();
  const now = deps.now || (() => Date.now());

  // ---- Refusals -------------------------------------------------------

  const refuse = (status, reason) => new HttpsError(status,
      pay.MESSAGES[reason] || "The request was refused.",
      {reason, reasons: [reason]});

  // ---- Small reads ----------------------------------------------------

  async function businessOf(businessId) {
    const snap = await db().collection("businesses")
        .doc(text(businessId, 128) || "-").get();
    return snap.exists ? snap.data() || {} : {};
  }

  /**
   * @param {string} requestId The id.
   * @param {string} [businessId] When given, the request must be this
   *   business's.
   * @return {Promise<{ref: object, request: object}>} The request.
   */
  async function loadRequest(requestId, businessId) {
    const id = text(requestId, 128);
    if (!id || id.includes("/")) throw refuse("not-found", "pay_not_found");
    const ref = db().collection(REQUESTS).doc(id);
    const snap = await ref.get();
    const request = snap.exists ? snap.data() || {} : null;
    if (!request || (businessId && text(request.businessId) !== businessId)) {
      throw refuse("not-found", "pay_not_found");
    }
    return {ref, request};
  }

  function staffName(user) {
    return text(user?.fullName || user?.displayName || user?.email ||
      "Staff", 120);
  }

  /**
   * The ledger / payout week a row falls into: its own, unless that week was
   * already paid out - then the current one (the row waits for the next
   * payout; a paid week never changes).
   *
   * @param {number} atMs When it happened.
   * @param {boolean} paidWeek The row's own week was already paid out.
   * @return {string} The week key.
   */
  function weekFor(atMs, paidWeek) {
    return pay.weekKeyFor(paidWeek ? now() : atMs);
  }

  const payoutRef = (businessId, weekKey) =>
    db().collection(PAYOUTS).doc(`${businessId}_${weekKey}`);

  // ---- WhatsApp -------------------------------------------------------

  async function safeSend(body) {
    try {
      return await deps.sendWhatsApp(body);
    } catch (error) {
      return {ok: false, error: String(error?.message || error).slice(0, 200),
        errorCode: 0};
    }
  }

  async function windowOpen(phone) {
    try {
      const snap = await db().collection("whatsappContacts")
          .doc(String(phone).replace(/\D/g, "")).get();
      return withinWindow(Number(snap.data()?.lastInboundAtMs) || 0, now());
    } catch (error) {
      return false;
    }
  }

  async function recordMessages(requestId, entries) {
    if (entries.length === 0) return;
    const ref = db().collection(REQUESTS).doc(requestId);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const row = snap.exists ? snap.data() || {} : null;
      if (!row || !row.payNow) return;
      let messages = row.payNow.messages;
      for (const entry of entries) {
        messages = pay.appendMessage(messages, entry);
      }
      tx.update(ref, {"payNow.messages": messages,
        "payNow.updatedAtMs": now()});
    }).catch((error) => logger.warn("Pay now message not recorded",
        {requestId, error: String(error?.message || error)}));
  }

  /**
   * Sends the pay link: the approved template, else (inside the customer's
   * 24 hours) a button message. Never throws: every attempt is written on
   * the request's payNow.messages.
   *
   * @param {string} requestId The request.
   * @param {object} request The request as it is now.
   * @return {Promise<object[]>} The attempts.
   */
  async function sendLink(requestId, request) {
    const payNow = request.payNow || {};
    const amountCents = cents(payNow.amountCents);
    const base = {atMs: now(), amountCents, kind: "link"};
    const phone = text(request.sender?.phoneE164, 30);
    const entries = [];
    if (!phone) {
      entries.push({...base, channel: "template", ok: false,
        error: "no_phone"});
    } else if (!deps.whatsappConfigured()) {
      entries.push({...base, channel: "template", ok: false,
        error: "whatsapp_not_configured"});
    } else {
      const template = await safeSend(pay.payNowTemplateMessage({
        phone, name: request.sender?.name, business: request.businessName,
        amountCents, code: request.code, token: payNow.token}));
      entries.push({...base, channel: "template", ok: template.ok === true,
        error: template.ok ? "" : template.error});
      if (!template.ok && template.errorCode !== deps.stoppedErrorCode &&
          await windowOpen(phone)) {
        const session = await safeSend(pay.payNowSessionMessage({phone,
          name: request.sender?.name, business: request.businessName,
          amountCents, code: request.code, url: payNow.linkUrl,
          language: request.language}));
        entries.push({...base, atMs: now(), channel: "session",
          ok: session.ok === true, error: session.ok ? "" : session.error});
      }
    }
    await recordMessages(requestId, entries);
    return entries;
  }

  // ---- After a request changes ----------------------------------------

  /**
   * Brings a request's payNow in line with the request (confirmed,
   * re-priced, closed, switch moved): creates the link, changes its amount,
   * cancels it, or updates the balance due / refund due. A new or changed
   * amount sends one message (unless `send` is false). Never throws.
   *
   * @param {string} requestId The request.
   * @param {object} [options] {send: false to only write}.
   * @return {Promise<string>} none | open | cancel | balances | error.
   */
  async function syncRequest(requestId, options = {}) {
    try {
      const ref = db().collection(REQUESTS).doc(text(requestId, 128));
      const nowMs = now();
      const outcome = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const request = snap.data() || {};
        const businessSnap = await tx.get(db().collection("businesses")
            .doc(text(request.businessId, 128) || "-"));
        const business = businessSnap.exists ? businessSnap.data() || {} : {};
        const plan = pay.payNowPlan(request, pay.payNowSettingsOf(business));
        if (plan.action === "none") return null;
        const token = request.payNow?.token ||
          crypto.randomBytes(24).toString("base64url");
        const chargeType = pay.chargeTypeOf(business);
        const next = pay.applyPlan(request.payNow || null, plan, {
          token, linkUrl: deps.linkUrl(token), chargeType,
          connectedAccountId: chargeType === pay.CHARGE_TYPE.DIRECT ?
            text(business.stripeAccountId, 80) : "",
          nowMs});
        const update = {payNow: next,
          updatedAt: FieldValue.serverTimestamp()};
        const historyAction = {open: "pay_link_ready",
          cancel: "pay_link_cancelled"}[plan.action];
        if (historyAction) {
          update.history = deps.appendHistory(request.history, {
            atMs: nowMs, action: historyAction, byUid: "", byName: "",
            ...(plan.amountCents ? {totalCents: plan.amountCents} : {})});
        }
        tx.update(ref, update);
        return {plan, request: {...request, payNow: next}};
      });
      if (!outcome) return "none";
      if (outcome.plan.notify && options.send !== false) {
        await sendLink(requestId, outcome.request);
      }
      return outcome.plan.action;
    } catch (error) {
      logger.warn("Pay now sync failed", {requestId: String(requestId),
        error: String(error?.message || error)});
      return "error";
    }
  }

  // ---- The link -------------------------------------------------------

  /**
   * The third resolver of the durable /p link: a package request's pay token.
   * Like the parking link it mints a fresh Checkout Session per visit (and
   * reuses an open one), and shows a plain page for a paid or cancelled one.
   *
   * @param {string} token The `t` query.
   * @param {object} res The Express response.
   * @return {Promise<boolean>} true when the token was a pay token and the
   *   response was sent.
   */
  async function resolveLink(token, res) {
    const matches = await db().collection(REQUESTS)
        .where("payNow.token", "==", token).limit(1).get();
    if (matches.empty) return false;
    const ref = matches.docs[0].ref;
    const request = matches.docs[0].data() || {};
    const payNow = request.payNow || {};
    const code = text(request.code, 20);
    const send = (title, message, status = 200) => res.status(status)
        .send(deps.page({title, message}));
    if (PAID_STATES.includes(payNow.status)) {
      send("Already paid", payNow.status === pay.STATUS.REFUNDED ?
        `Shipment ${code} was paid and then refunded. Contact the business ` +
          "if you have questions." :
        `Shipment ${code} is paid online. Nothing further is owed online.`);
      return true;
    }
    if (payNow.status !== pay.STATUS.OPEN) {
      send("Link cancelled", "The business cancelled this payment link. " +
        "Contact them if you think this is a mistake.");
      return true;
    }
    const business = await businessOf(request.businessId);
    const state = pay.payNowState(request, pay.payNowSettingsOf(business));
    if (!state.payable) {
      send("Not available right now", `Shipment ${code} cannot be paid ` +
        "online right now. You can pay at the counter, or ask the business.");
      return true;
    }
    const chargeType = pay.chargeTypeOf(business);
    const direct = chargeType === pay.CHARGE_TYPE.DIRECT;
    const accountId = direct ? text(business.stripeAccountId, 80) : "";
    try {
      const sessionId = text(payNow.checkoutSessionId, 200);
      if (sessionId) {
        const sessionAccount = payNow.chargeType === pay.CHARGE_TYPE.DIRECT ?
          text(payNow.connectedAccountId, 80) : "";
        const existing = await stripe.retrieveCheckoutSession(sessionId,
            sessionAccount || undefined).catch(() => null);
        if (existing && existing.payment_status === "paid") {
          // The webhook has not landed yet (or never will): settle it now.
          const intentId = text(existing.payment_intent, 100);
          if (intentId) {
            const intent = await stripe.retrievePaymentIntent(intentId,
                sessionAccount || undefined);
            await recordPaid({intent, accountId: sessionAccount,
              sessionId});
          }
          send("Already paid", `Shipment ${code} is paid online. Nothing ` +
            "further is owed online.");
          return true;
        }
        if (stripe.reusable({session: existing, nowMs: now()}) &&
            Number(existing.amount_total) === state.amountCents &&
            sessionAccount === accountId) {
          res.redirect(303, String(existing.url || ""));
          return true;
        }
      }
      const mintCount = cents(payNow.mintCount) + 1;
      const session = await stripe.createCheckoutSession({
        amount: state.amountCents,
        currency: "usd",
        productName: `${text(business.name || request.businessName, 80)} ` +
          `shipment ${code}`,
        recordId: ref.id,
        idempotencySeed: `package-request-pay:${ref.id}:${mintCount}`,
        connectedAccountId: accountId || undefined,
        metadata: {
          paymentType: pay.PAYMENT_TYPE,
          requestId: ref.id,
          businessId: text(request.businessId, 128),
          code,
        },
        ...deps.returnUrls(request),
      });
      await ref.update({
        "payNow.checkoutSessionId": text(session.id, 200),
        "payNow.mintCount": mintCount,
        "payNow.amountCents": state.amountCents,
        "payNow.chargeType": chargeType,
        "payNow.connectedAccountId": accountId,
        "payNow.updatedAtMs": now(),
      });
      res.redirect(303, String(session.url || ""));
    } catch (error) {
      logger.error("Pay now link could not open a session", {
        requestId: ref.id, detail: String(error?.message || error)});
      send("Payment unavailable", "We could not open the payment page " +
        "right now. Please try again in a moment.", 500);
    }
    return true;
  }

  // ---- A payment landed -----------------------------------------------

  /**
   * Records a successful payment. Idempotent (a replayed event, the webhook
   * and the link's own check can all arrive): the second one finds the
   * request already paid with this PaymentIntent. A second, different
   * PaymentIntent on a paid request is a double charge: it is refunded.
   *
   * @param {object} args {intent (the PaymentIntent), accountId (the
   *   connected account for a direct charge, else ""), sessionId?}.
   * @return {Promise<boolean>} true when it belongs to a request.
   */
  async function recordPaid({intent, accountId, sessionId = ""}) {
    const metadata = intent?.metadata || {};
    const requestId = text(metadata.requestId, 128);
    if (!requestId || requestId.includes("/") ||
        String(intent?.status) !== "succeeded") {
      return false;
    }
    const ref = db().collection(REQUESTS).doc(requestId);
    const first = await ref.get();
    if (!first.exists) {
      logger.warn("Pay now payment for a missing request", {requestId});
      return false;
    }
    const known = first.data() || {};
    if (text(known.businessId) !== text(metadata.businessId)) {
      logger.error("Pay now payment names another business", {requestId});
      return false;
    }
    const piId = text(intent.id, 100);
    if (PAID_STATES.includes(known.payNow?.status) &&
        known.payNow.paymentIntentId === piId) {
      return true;
    }
    const direct = Boolean(accountId);
    const paidCents = cents(intent.amount_received) || cents(intent.amount);
    const chargeId = typeof intent.latest_charge === "string" ?
      intent.latest_charge : text(intent.latest_charge?.id, 100);
    let stripeFeeCents = 0;
    let chargedAtMs = 0;
    if (chargeId.startsWith("ch_")) {
      const charge = await stripe.retrieveCharge(chargeId,
          accountId || undefined);
      chargedAtMs = (Number(charge.created) || 0) * 1000;
      const balanceId = typeof charge.balance_transaction === "string" ?
        charge.balance_transaction : text(charge.balance_transaction?.id);
      if (balanceId) {
        stripeFeeCents = stripe.stripeOnlyFeeCents(
            await stripe.retrieveBalanceTransaction(balanceId,
                accountId || undefined));
      }
    }
    const nowMs = now();
    const paidAtMs = chargedAtMs || nowMs;
    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const row = snap.data() || {};
      const current = row.payNow || null;
      if (current && PAID_STATES.includes(current.status)) {
        return current.paymentIntentId === piId ? {already: true} :
          {duplicate: true};
      }
      const businessId = text(row.businessId, 128);
      const payoutSnap = direct ? null : await tx.get(payoutRef(businessId,
          pay.weekKeyFor(paidAtMs)));
      const token = current?.token ||
        crypto.randomBytes(24).toString("base64url");
      const base = current || pay.newPayNow({token,
        linkUrl: deps.linkUrl(token), amountCents: paidCents,
        chargeType: direct ? pay.CHARGE_TYPE.DIRECT :
          pay.CHARGE_TYPE.PLATFORM, connectedAccountId: accountId, nowMs});
      const next = {...base,
        status: pay.STATUS.PAID,
        chargeType: direct ? pay.CHARGE_TYPE.DIRECT :
          pay.CHARGE_TYPE.PLATFORM,
        connectedAccountId: accountId,
        checkoutSessionId: text(sessionId || base.checkoutSessionId, 200),
        paymentIntentId: piId,
        chargeId,
        paidAtMs,
        paidCents,
        stripeFeeCents,
        refundedCents: 0,
        refunds: [],
        updatedAtMs: nowMs};
      Object.assign(next, pay.payNowBalances({...row, payNow: next}));
      tx.update(ref, {
        payNow: next,
        history: deps.appendHistory(row.history, {
          atMs: nowMs, action: "paid_online", byUid: "",
          byName: text(row.sender?.name, 120), totalCents: paidCents}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (!direct) {
        const weekKey = weekFor(paidAtMs, payoutSnap?.data()?.status ===
          pay.PAYOUT_STATUS.PAID);
        for (const {id, row: ledger} of pay.paymentRows({businessId,
          requestId, requestCode: row.code, paidCents, stripeFeeCents,
          atMs: paidAtMs, weekKey})) {
          tx.set(db().collection(LEDGER).doc(id), {...ledger,
            createdAt: FieldValue.serverTimestamp()});
        }
      }
      return {paid: true, request: {...row, payNow: next}};
    });
    if (result.duplicate) {
      await refundDuplicate({requestId, intent, accountId, paidCents});
      return true;
    }
    if (result.paid) {
      await deps.notifyStaff(db(), {
        businessId: text(result.request.businessId, 128), requestId,
        request: result.request, event: "paid_online",
        words: (language) => pay.paidNotificationText(result.request,
            paidCents, language)});
    }
    return true;
  }

  async function refundDuplicate({requestId, intent, accountId, paidCents}) {
    const piId = text(intent.id, 100);
    try {
      await stripe.createRefund({
        paymentIntentId: piId, amount: paidCents,
        connectedAccountId: accountId || undefined,
        idempotencyKey: `laawol-pay-dup-v1-${piId}`,
        metadata: {paymentType: pay.PAYMENT_TYPE, requestId,
          reason: "duplicate_payment"}});
      logger.warn("Pay now duplicate payment refunded", {requestId, piId});
    } catch (error) {
      logger.error("Pay now duplicate payment NOT refunded - refund it " +
        "by hand", {requestId, piId, error: String(error?.message || error)});
    }
  }

  // ---- Disputes -------------------------------------------------------

  async function handleDispute(event) {
    const dispute = event.data?.object || {};
    const accountId = text(event.account, 80);
    let intentId = text(dispute.payment_intent, 100);
    if (!intentId.startsWith("pi_") && text(dispute.charge, 100)
        .startsWith("ch_")) {
      const charge = await stripe.retrieveCharge(text(dispute.charge, 100),
          accountId || undefined);
      intentId = text(charge.payment_intent, 100);
    }
    if (!intentId.startsWith("pi_")) return false;
    const intent = await stripe.retrievePaymentIntent(intentId,
        accountId || undefined);
    if (intent?.metadata?.paymentType !== pay.PAYMENT_TYPE) return false;
    const requestId = text(intent.metadata.requestId, 128);
    const ref = db().collection(REQUESTS).doc(requestId || "-");
    const won = event.type === "charge.dispute.closed";
    if (won && text(dispute.status) !== "won") return true;
    const nowMs = now();
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const row = snap.data() || {};
      const businessId = text(row.businessId, 128);
      const platform = row.payNow?.chargeType !== pay.CHARGE_TYPE.DIRECT;
      const payoutSnap = platform ? await tx.get(payoutRef(businessId,
          pay.weekKeyFor(nowMs))) : null;
      const disputeId = text(dispute.id, 80);
      const known = Array.isArray(row.payNow?.disputes) ?
        row.payNow.disputes : [];
      const entry = known.find((d) => d.id === disputeId);
      if (won ? entry?.won === true : Boolean(entry)) return;
      const amountCents = cents(dispute.amount);
      const disputes = won ?
        known.map((d) => d.id === disputeId ? {...d, won: true} : d) :
        [...known, {id: disputeId, amountCents, atMs: nowMs, won: false}];
      tx.update(ref, {
        "payNow.disputes": disputes,
        "payNow.updatedAtMs": nowMs,
        "history": deps.appendHistory(row.history, {atMs: nowMs,
          action: won ? "dispute_won" : "dispute_opened", byUid: "",
          byName: "", totalCents: amountCents}),
        "updatedAt": FieldValue.serverTimestamp(),
      });
      if (!platform) return;
      const weekKey = weekFor(nowMs, payoutSnap?.data()?.status ===
        pay.PAYOUT_STATUS.PAID);
      const args = {businessId, requestId, requestCode: row.code,
        disputeId, amountCents, atMs: nowMs, weekKey};
      const rows = won ? [pay.disputeWonRow(args)] : pay.disputeRows(args);
      for (const {id, row: ledger} of rows) {
        tx.set(db().collection(LEDGER).doc(id), {...ledger,
          createdAt: FieldValue.serverTimestamp()});
      }
    });
    return true;
  }

  /**
   * The Stripe webhook's branch for pay-now payments. Runs before the
   * generic payment reconciler (which has no route for this type).
   *
   * @param {object} event The verified Stripe event.
   * @return {Promise<boolean>} true when the event was a pay-now event and
   *   is fully handled (the caller acknowledges it and stops).
   */
  async function handleStripeEvent(event) {
    const type = text(event?.type, 80);
    const object = event?.data?.object || {};
    const accountId = text(event?.account, 80);
    const mine = object.metadata?.paymentType === pay.PAYMENT_TYPE;
    if (type === "checkout.session.completed" ||
        type === "checkout.session.async_payment_succeeded") {
      if (!mine) return false;
      if (object.payment_status === "paid" &&
          text(object.payment_intent, 100).startsWith("pi_")) {
        const intent = await stripe.retrievePaymentIntent(
            text(object.payment_intent, 100), accountId || undefined);
        await recordPaid({intent, accountId, sessionId: text(object.id, 200)});
      }
      return true;
    }
    if (type === "payment_intent.succeeded") {
      if (!mine) return false;
      await recordPaid({intent: object, accountId});
      return true;
    }
    // A session that expired or a card that failed: the link stays good and
    // mints a new session on the next visit, so nothing to write.
    if (type === "checkout.session.expired" ||
        type === "checkout.session.async_payment_failed" ||
        type === "payment_intent.payment_failed") {
      return mine;
    }
    if (type === "charge.dispute.created" ||
        type === "charge.dispute.closed") {
      return handleDispute(event);
    }
    return false;
  }

  // ---- Received -------------------------------------------------------

  /**
   * What the counter does not charge again at Received.
   *
   * @param {object} request The request.
   * @param {?number} totalCents The line's price (null when unpriced).
   * @return {number} The online payment to record on the line (never more
   *   than the price).
   */
  function receiveCredit(request, totalCents) {
    const net = pay.netPaidCents(request?.payNow);
    return Number.isInteger(totalCents) ? Math.min(net, totalCents) : net;
  }

  // ---- Staff actions --------------------------------------------------

  /**
   * @param {object} payNow The stored payNow.
   * @return {object} What staff get back (the whole record: staff are the
   *   business).
   */
  function staffView(payNow) {
    return payNow ? {...payNow} : null;
  }

  async function refund(user, uid, data) {
    const businessId = text(data.businessId, 128);
    const mayRefund = user.role === "admin" || user.role === "businessOwner" ||
      (user.role === "staff" && Array.isArray(user.businessPermissions) &&
        user.businessPermissions.includes("containers") &&
        user.businessPermissions.includes("ledger"));
    if (!mayRefund) throw refuse("permission-denied", pay.REASON.NOT_ALLOWED);
    const {ref, request} = await loadRequest(data.requestId, businessId);
    const decision = pay.refundDecision(request.payNow, data.amountCents,
        data.reason);
    if (!decision.ok) {
      throw refuse(decision.reason === pay.REASON.PAY_NOT_PAID ||
        decision.reason === pay.REASON.REFUND_TOO_MUCH ?
        "failed-precondition" : "invalid-argument", decision.reason);
    }
    const payNow = request.payNow;
    const direct = payNow.chargeType === pay.CHARGE_TYPE.DIRECT;
    const accountId = direct ? text(payNow.connectedAccountId, 80) : "";
    const stripeRefund = await stripe.createRefund({
      paymentIntentId: payNow.paymentIntentId,
      amount: decision.amountCents,
      connectedAccountId: accountId || undefined,
      // The same refund asked twice (a retry, a double tap) is one refund.
      idempotencyKey: `laawol-pay-refund-v1-${ref.id}-` +
        `${cents(payNow.refundedCents)}-${decision.amountCents}`,
      metadata: {paymentType: pay.PAYMENT_TYPE, requestId: ref.id,
        businessId, refundedBy: uid}});
    if (!stripeRefund || ["failed", "canceled"].includes(
        String(stripeRefund.status))) {
      throw new HttpsError("failed-precondition",
          "The card refund did not go through. Try again, or refund it in " +
          "Stripe.", {reason: "refund_failed", reasons: ["refund_failed"]});
    }
    const nowMs = now();
    const name = staffName(user);
    const refundId = text(stripeRefund.id, 80);
    const done = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const row = snap.data() || {};
      const current = row.payNow || {};
      if ((current.refunds || []).some((r) => r.refundId === refundId)) {
        return {already: true, payNow: current, request: row};
      }
      const platform = current.chargeType !== pay.CHARGE_TYPE.DIRECT;
      const payoutSnap = platform ? await tx.get(payoutRef(businessId,
          pay.weekKeyFor(nowMs))) : null;
      // The line payment this request left at Received, when it was.
      let linePayment = null;
      let lineRef = null;
      let linePayments = [];
      if (row.lineId && current.linePaymentId) {
        lineRef = db().collection("containerLines").doc(row.lineId);
        const payRef = db().collection(LINE_PAYMENTS)
            .doc(current.linePaymentId);
        const [paySnap, paysSnap] = await Promise.all([tx.get(payRef),
          tx.get(db().collection(LINE_PAYMENTS)
              .where("businessId", "==", businessId)
              .where("lineId", "==", row.lineId))]);
        if (paySnap.exists) linePayment = {ref: payRef, ...paySnap.data()};
        linePayments = paysSnap.docs.map((d) => ({id: d.id, ...d.data()}));
      }
      const next = pay.applyRefund(current, {atMs: nowMs,
        amountCents: decision.amountCents, byUid: uid, byName: name,
        reason: decision.note, refundId});
      Object.assign(next, pay.payNowBalances({...row, payNow: next}));
      tx.update(ref, {
        payNow: next,
        history: deps.appendHistory(row.history, {atMs: nowMs,
          action: "refunded_online", byUid: uid, byName: name,
          totalCents: decision.amountCents, reason: decision.note}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (platform) {
        const weekKey = weekFor(nowMs, payoutSnap?.data()?.status ===
          pay.PAYOUT_STATUS.PAID);
        const {id, row: ledger} = pay.refundRow({businessId,
          requestId: ref.id, requestCode: row.code, refundId,
          amountCents: decision.amountCents, atMs: nowMs, byUid: uid,
          byName: name, note: decision.note, weekKey});
        tx.set(db().collection(LEDGER).doc(id), {...ledger,
          createdAt: FieldValue.serverTimestamp()});
      }
      if (linePayment && lineRef) {
        // The counter's credit shrinks with the refund; the line owes it.
        const left = Math.max(0, cents(linePayment.amountCents) -
          decision.amountCents);
        tx.update(linePayment.ref, left > 0 ? {amountCents: left} :
          {amountCents: 0, reverted: true, revertedByStaffId: uid,
            revertedAt: FieldValue.serverTimestamp()});
        const paid = linePayments.reduce((sum, p) => p.reverted === true ?
          sum : sum + cents(p.id === linePayment.ref.id ? left :
            p.amountCents), 0);
        tx.update(lineRef, {paidCents: paid,
          updatedAt: FieldValue.serverTimestamp()});
      }
      return {already: false, payNow: next, request: {...row, payNow: next}};
    });
    if (!done.already) {
      await sendRefundNotice(ref.id, done.request, decision.amountCents);
    }
    return {success: true, payNow: staffView(done.payNow)};
  }

  async function sendRefundNotice(requestId, request, amountCents) {
    const phone = text(request.sender?.phoneE164, 30);
    const base = {atMs: now(), amountCents, kind: "refund",
      channel: "session"};
    if (!phone || !deps.whatsappConfigured()) {
      await recordMessages(requestId, [{...base, ok: false,
        error: phone ? "whatsapp_not_configured" : "no_phone"}]);
      return;
    }
    // No approved template for a refund: a plain message, only inside the
    // customer's own 24 hours.
    if (!await windowOpen(phone)) {
      await recordMessages(requestId, [{...base, ok: false,
        error: "outside_24h_window"}]);
      return;
    }
    const sent = await safeSend(pay.refundTextMessage({phone,
      name: request.sender?.name, business: request.businessName,
      code: request.code, amountCents, language: request.language}));
    await recordMessages(requestId, [{...base, ok: sent.ok === true,
      error: sent.ok ? "" : sent.error}]);
  }

  async function resend(user, data) {
    const businessId = text(data.businessId, 128);
    const allowed = user.role === "admin" || user.role === "businessOwner" ||
      (Array.isArray(user.businessPermissions) &&
        user.businessPermissions.includes("containers"));
    if (!allowed) throw refuse("permission-denied", pay.REASON.NOT_ALLOWED);
    const {ref} = await loadRequest(data.requestId, businessId);
    await syncRequest(ref.id, {send: false});
    const request = (await ref.get()).data() || {};
    if (request.payNow?.status !== pay.STATUS.OPEN) {
      throw refuse("failed-precondition", pay.REASON.PAY_NOT_OPEN);
    }
    await sendLink(ref.id, request);
    const fresh = (await ref.get()).data() || {};
    return {success: true, payNow: staffView(fresh.payNow)};
  }

  // ---- The Laawol bill ------------------------------------------------

  /**
   * What each business owes Laawol today: its closed months still unpaid and
   * its pay-now adjustments (a negative week put on the bill) not yet taken
   * out of a payout.
   *
   * @param {string[]} businessIds The businesses (all of them when empty).
   * @return {Promise<Map<string, number>>} Cents by business.
   */
  async function unpaidBills(businessIds) {
    const out = new Map();
    const wanted = new Set(businessIds);
    const add = (businessId, value) => {
      if (wanted.size > 0 && !wanted.has(businessId)) return;
      out.set(businessId, (out.get(businessId) || 0) + value);
    };
    let months;
    let adjustments;
    if (businessIds.length === 1) {
      [months, adjustments] = await Promise.all([
        db().collection(BILLING_MONTHS)
            .where("businessId", "==", businessIds[0]).limit(240).get(),
        db().collection(BILLING_ADJUSTMENTS)
            .where("businessId", "==", businessIds[0]).limit(240).get()]);
    } else {
      [months, adjustments] = await Promise.all([
        db().collection(BILLING_MONTHS).where("status", "==", "closed")
            .where("unpaidCents", ">", 0).limit(2000).get(),
        db().collection(BILLING_ADJUSTMENTS)
            .where("outstandingCents", ">", 0).limit(2000).get()]);
    }
    for (const doc of months.docs) {
      const m = doc.data() || {};
      if (m.status === "closed") add(text(m.businessId), cents(m.unpaidCents));
    }
    for (const doc of adjustments.docs) {
      const a = doc.data() || {};
      add(text(a.businessId), cents(a.outstandingCents));
    }
    return out;
  }

  // ---- Payouts --------------------------------------------------------

  const trimLine = (id, row) => ({id, type: row.type,
    amountCents: Number(row.amountCents) || 0, requestId: row.requestId || "",
    requestCode: row.requestCode || "", atMs: Number(row.atMs) || 0,
    byName: row.byName || "", note: row.note || ""});

  const payoutNumbers = (s) => ({collectedCents: s.collectedCents,
    feesCents: s.feesCents, refundsCents: s.refundsCents,
    chargebacksCents: s.chargebacksCents, billOffsetCents: s.billOffsetCents,
    netCents: s.netCents, toBillCents: s.toBillCents,
    payoutCents: s.payoutCents});

  async function payouts(user, data) {
    const businessId = text(data.businessId, 128);
    const finance = user.role === "admin" &&
      (deps.hasAdminCapability(user, "finance") ||
        deps.hasAdminSectionAccess(user, "finance", "view"));
    const owner = Boolean(businessId) && user.role === "businessOwner" &&
      text(user.businessId, 128) === businessId;
    if (!finance && !owner) {
      throw refuse("permission-denied", pay.REASON.NOT_ALLOWED);
    }
    const nowMs = now();
    const cutoff = pay.addDays(pay.weekKeyFor(nowMs),
        -7 * ALL_BUSINESSES_WEEKS);
    const [ledgerSnap, payoutSnap] = businessId ? await Promise.all([
      db().collection(LEDGER).where("businessId", "==", businessId)
          .limit(LEDGER_PAGE).get(),
      db().collection(PAYOUTS).where("businessId", "==", businessId)
          .limit(500).get()]) : await Promise.all([
            db().collection(LEDGER).where("weekKey", ">=", cutoff)
                .limit(LEDGER_PAGE).get(),
            db().collection(PAYOUTS).where("weekKey", ">=", cutoff)
                .limit(2000).get()]);
    const byWeek = new Map();
    for (const doc of ledgerSnap.docs) {
      const row = doc.data() || {};
      const key = `${row.businessId}|${row.weekKey}`;
      if (!byWeek.has(key)) {
        byWeek.set(key, {businessId: text(row.businessId),
          weekKey: text(row.weekKey), rows: []});
      }
      byWeek.get(key).rows.push({id: doc.id, ...row});
    }
    const paid = new Map(payoutSnap.docs.map((doc) => [
      `${doc.data().businessId}|${doc.data().weekKey}`, doc.data() || {}]));
    for (const [key, doc] of paid) {
      if (!byWeek.has(key)) {
        byWeek.set(key, {businessId: text(doc.businessId),
          weekKey: text(doc.weekKey), rows: []});
      }
    }
    const ids = [...new Set([...byWeek.values()].map((w) => w.businessId))];
    const [bills, names] = await Promise.all([
      unpaidBills(businessId ? [businessId] : ids),
      Promise.all(ids.map(async (id) => [id, text((await businessOf(id))
          .name, 120) || id]))]);
    const nameOf = new Map(names);
    // Each business's bill is spread over its unpaid weeks, oldest first.
    const offsets = new Map();
    for (const id of ids) {
      const open = [...byWeek.values()].filter((w) => w.businessId === id &&
        !paid.has(`${id}|${w.weekKey}`))
          .map((w) => ({weekKey: w.weekKey, beforeBillCents:
            pay.summarizeWeek(w.rows).beforeBillCents}));
      for (const [week, take] of pay.planOffsets(open, bills.get(id) || 0)) {
        offsets.set(`${id}|${week}`, take);
      }
    }
    const weeks = [...byWeek.values()].map((w) => {
      const key = `${w.businessId}|${w.weekKey}`;
      const stored = paid.get(key);
      const range = pay.weekRange(w.weekKey);
      const summary = pay.summarizeWeek(w.rows.filter((r) => ![
        pay.LEDGER_TYPE.BILL_OFFSET, pay.LEDGER_TYPE.PAYOUT,
        pay.LEDGER_TYPE.TO_BILL].includes(r.type)),
      {unpaidBillCents: offsets.get(key) || 0});
      const numbers = stored ? {
        collectedCents: cents(stored.collectedCents),
        feesCents: cents(stored.feesCents),
        refundsCents: cents(stored.refundsCents),
        chargebacksCents: Number(stored.chargebacksCents) || 0,
        billOffsetCents: cents(stored.billOffsetCents),
        netCents: Number(stored.netCents) || 0,
        toBillCents: cents(stored.toBillCents),
        payoutCents: cents(stored.payoutCents)} : payoutNumbers(summary);
      return {
        businessId: w.businessId,
        businessName: nameOf.get(w.businessId) || w.businessId,
        weekKey: w.weekKey, startKey: range.startKey, endKey: range.endKey,
        payoutKey: range.payoutKey,
        status: pay.weekStatus({weekKey: w.weekKey, nowMs, summary,
          paid: Boolean(stored), rows: w.rows.length}),
        ...numbers,
        paidAtMs: Number(stored?.paidAtMs) || 0,
        paidByName: text(stored?.paidByName, 120),
        method: text(stored?.method, 20),
        reference: text(stored?.reference, 120),
        receiptSent: stored?.receiptSent === true,
        lines: w.rows.sort((a, b) => (Number(a.atMs) || 0) -
          (Number(b.atMs) || 0)).map((r) => trimLine(r.id, r)),
      };
    }).sort((a, b) => b.weekKey.localeCompare(a.weekKey) ||
      a.businessName.localeCompare(b.businessName));
    const unpaidBillCents = businessId ? bills.get(businessId) || 0 :
      [...bills.values()].reduce((sum, v) => sum + v, 0);
    return {success: true, weeks, unpaidBillCents,
      ...(businessId ? {} : {unpaidBillByBusiness:
        Object.fromEntries(bills)})};
  }

  const dayKeyNow = () => pay.zonedDayKey(now());

  async function payoutPaid(user, uid, data) {
    if (!(user.role === "admin" && text(user.adminRole, 40) === "superAdmin")) {
      throw refuse("permission-denied", pay.REASON.NOT_ALLOWED);
    }
    const businessId = text(data.businessId, 128);
    if (!businessId || businessId.includes("/")) {
      throw refuse("invalid-argument", pay.REASON.BUSINESS_REQUIRED);
    }
    const nowMs = now();
    const input = pay.cleanPayoutInput(data, nowMs);
    if (input.errors.length > 0) {
      throw refuse("invalid-argument", input.errors[0]);
    }
    const business = await businessOf(businessId);
    const name = staffName(user);
    const ref = payoutRef(businessId, input.weekKey);
    const outcome = await db().runTransaction(async (tx) => {
      const [paidSnap, rowsSnap, monthsSnap, adjSnap] = await Promise.all([
        tx.get(ref),
        tx.get(db().collection(LEDGER).where("businessId", "==", businessId)
            .where("weekKey", "==", input.weekKey)),
        tx.get(db().collection(BILLING_MONTHS)
            .where("businessId", "==", businessId)),
        tx.get(db().collection(BILLING_ADJUSTMENTS)
            .where("businessId", "==", businessId))]);
      if (paidSnap.exists && paidSnap.data()?.status ===
          pay.PAYOUT_STATUS.PAID) {
        throw refuse("failed-precondition", pay.REASON.WEEK_ALREADY_PAID);
      }
      const rows = rowsSnap.docs.map((d) => ({id: d.id, ...d.data()}));
      if (rows.length === 0) {
        throw refuse("failed-precondition",
            pay.REASON.WEEK_EMPTY);
      }
      const months = monthsSnap.docs
          .map((d) => ({ref: d.ref, ...d.data()}))
          .filter((m) => m.status === "closed" && cents(m.unpaidCents) > 0)
          .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      const adjustments = adjSnap.docs
          .map((d) => ({ref: d.ref, ...d.data()}))
          .filter((a) => cents(a.outstandingCents) > 0)
          .sort((a, b) => (Number(a.createdAtMs) || 0) -
            (Number(b.createdAtMs) || 0));
      const bill = months.reduce((s, m) => s + cents(m.unpaidCents), 0) +
        adjustments.reduce((s, a) => s + cents(a.outstandingCents), 0);
      const plan = pay.payoutPlan(rows, bill);
      if (plan.kind === "empty") {
        throw refuse("failed-precondition", pay.REASON.WEEK_EMPTY);
      }
      if (plan.payoutCents > 0 && !input.method) {
        throw refuse("invalid-argument", pay.REASON.METHOD_INVALID);
      }
      // Take the bill out of the week, oldest month first: each is a bill
      // payment (method pay_now_offset), so the Laawol bill shows it.
      let left = plan.billOffsetCents;
      for (const month of months) {
        if (left <= 0) break;
        if (cents(month.paymentCount) >= MAX_BILL_PAYMENTS_PER_MONTH) continue;
        const take = Math.min(left, cents(month.unpaidCents));
        left -= take;
        const paymentRef = db().collection(BILLING_PAYMENTS).doc(
            `paynow_${businessId}_${input.weekKey}_${month.month}`);
        tx.set(paymentRef, {
          businessId, month: text(month.month, 7), amountCents: take,
          paidOn: dayKeyNow(), method: OFFSET_METHOD,
          note: `Pay now week of ${input.weekKey}`,
          recordedBy: uid, recordedAtMs: nowMs, voided: false,
          payNowWeekKey: input.weekKey,
          createdAt: FieldValue.serverTimestamp()});
        tx.set(month.ref, {
          paidCents: cents(month.paidCents) + take,
          paymentCount: cents(month.paymentCount) + 1,
          unpaidCents: cents(month.unpaidCents) - take,
          updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      }
      for (const adjustment of adjustments) {
        if (left <= 0) break;
        const take = Math.min(left, cents(adjustment.outstandingCents));
        left -= take;
        tx.set(adjustment.ref, {
          settledCents: cents(adjustment.settledCents) + take,
          outstandingCents: cents(adjustment.outstandingCents) - take,
          updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      }
      if (plan.toBillCents > 0) {
        // A negative week: Laawol paid out more (refunds, fees, chargebacks)
        // than it collected. It goes on the bill, to come out of the next
        // payouts.
        tx.set(db().collection(BILLING_ADJUSTMENTS)
            .doc(`${businessId}_${input.weekKey}`), {
          businessId, month: dayKeyNow().slice(0, 7),
          amountCents: plan.toBillCents, settledCents: 0,
          outstandingCents: plan.toBillCents,
          reason: "pay_now_negative_week", weekKey: input.weekKey,
          createdAtMs: nowMs, createdBy: uid, voided: false,
          createdAt: FieldValue.serverTimestamp()});
      }
      for (const {id, row} of pay.payoutRows({businessId,
        weekKey: input.weekKey, plan, atMs: nowMs, byUid: uid, byName: name,
        method: input.method, reference: input.reference})) {
        tx.set(db().collection(LEDGER).doc(id), {...row,
          createdAt: FieldValue.serverTimestamp()});
      }
      const doc = {
        businessId,
        businessName: text(business.name, 120) || businessId,
        weekKey: input.weekKey,
        ...payoutNumbers(plan),
        status: pay.PAYOUT_STATUS.PAID,
        paidAtMs: nowMs, paidByUid: uid, paidByName: name,
        method: plan.payoutCents > 0 ? input.method : "",
        reference: input.reference,
        receiptSent: false,
      };
      tx.set(ref, {...doc, createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()});
      deps.setAdminAuditLog(tx, {
        action: "pay_now_payout_paid", actorUid: uid,
        actorRole: "superAdmin", targetCollection: PAYOUTS,
        targetId: ref.id, targetLabel: doc.businessName,
        nextValue: plan.payoutCents,
        metadata: {businessId, weekKey: input.weekKey,
          billOffsetCents: plan.billOffsetCents,
          toBillCents: plan.toBillCents, method: doc.method}});
      return {doc, plan};
    });
    const receiptSent = outcome.plan.payoutCents > 0 ?
      await sendPayoutReceipt(business, outcome.doc) : false;
    if (outcome.plan.payoutCents > 0) {
      await ref.update({receiptSent,
        updatedAt: FieldValue.serverTimestamp()}).catch(() => {});
    }
    return {success: true, payout: {...outcome.doc, receiptSent},
      receiptSent};
  }

  async function sendPayoutReceipt(business, payout) {
    try {
      if (!deps.whatsappConfigured()) return false;
      const ownerUid = text(business.ownerUid, 128);
      const owner = ownerUid ? (await db().collection("users").doc(ownerUid)
          .get()).data() || {} : {};
      const phone = [owner.phoneE164, owner.phone, business.ownerPhone,
        business.phone].map((p) => text(p, 30))
          .find((p) => /^\+?\d{8,15}$/.test(p.replace(/[\s()-]/g, ""))) || "";
      if (!phone) return false;
      const sent = await safeSend(pay.payoutTemplateMessage({
        phone: phone.replace(/[\s()-]/g, ""),
        name: text(owner.fullName || owner.displayName || business.name, 60)
            .split(" ")[0],
        amountCents: payout.payoutCents, weekKey: payout.weekKey,
        method: payout.method}));
      return sent.ok === true;
    } catch (error) {
      logger.warn("Pay now payout receipt failed", {
        error: String(error?.message || error)});
      return false;
    }
  }

  // ---- The callable's door ----------------------------------------

  /**
   * @param {*} action data.action.
   * @return {boolean} Whether setPackageRequestSettings should hand the call
   *   here.
   */
  function isAction(action) {
    return ACTIONS.includes(String(action || ""));
  }

  /**
   * Runs one pay-now staff action.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} The action's answer.
   */
  async function handleAction(request) {
    const uid = deps.requireAuth(request);
    const user = await deps.getUserProfile(uid);
    const data = request.data || {};
    switch (String(data.action)) {
      case "pay_refund": {
        await requireBusiness(user, data);
        return refund(user, uid, data);
      }
      case "pay_resend": {
        await requireBusiness(user, data);
        return resend(user, data);
      }
      case "payouts":
        return payouts(user, data);
      default:
        return payoutPaid(user, uid, data);
    }
  }

  async function requireBusiness(user, data) {
    const businessId = text(data.businessId, 128);
    if (!businessId || !deps.canManageBusiness(user, businessId)) {
      throw refuse("permission-denied", pay.REASON.NOT_ALLOWED);
    }
  }

  return {
    isAction,
    handleAction,
    syncRequest,
    resolveLink,
    handleStripeEvent,
    recordPaid,
    receiveCredit,
    refund,
    resend,
    payouts,
    payoutPaid,
  };
}

module.exports = {createPackagePayNowHandlers, OFFSET_METHOD};
