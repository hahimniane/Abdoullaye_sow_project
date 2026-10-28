"use strict";

/**
 * Two-way WhatsApp, the Firestore half (docs/WHATSAPP_CONVERSATIONS.md).
 *
 * A conversation is a Support case (`supportCases/wa_{inbox}_{digits}`,
 * caseType "whatsapp") so it reuses the Support inbox, its messages,
 * attachments and notifications. The pure decisions live in
 * whatsapp_inbox.js; this module reads and writes Firestore and Storage and
 * calls the injected WhatsApp sender. Everything that talks to the network
 * is injected so the emulator tests can run it.
 *
 * Collections (all server-only):
 *   whatsappContacts/{e164}  - per number: language, which businesses last
 *                              messaged it (lastSentAtMs, trackingCode), and
 *                              a pending "which business?" question.
 *   whatsappStops/{e164}     - {stopped} after STOP / START.
 *   whatsappInbound/{wamid}  - one per received message (dedupe).
 *   whatsappMessages/{wamid} - our sent message -> its thread message path,
 *                              for delivery ticks.
 *   whatsappMedia/{id}       - files we stored, for the 12-month deletion.
 *   whatsappTemplateCounts/{inbox}_{yyyy-mm} - templates sent per business.
 *   appConfig/whatsappInbox  - {mode: laawol_only | businesses}.
 */

const crypto = require("crypto");
const wa = require("./whatsapp_inbox");

const TRACK_URL = "https://customer.laawoldigital.com/t/";
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
// WhatsApp plays these as voice notes / audio; anything else goes as a file.
const WA_AUDIO_TYPES = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac",
  "audio/amr"];
const CHOOSING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const CLOSED_REPLY_GAP_MS = 12 * 60 * 60 * 1000;
const RECEIVED_REPLY_GAP_MS = 3 * 24 * 60 * 60 * 1000;
const STOPPED_ERROR_CODE = -131050;

/**
 * A short, Firestore-safe message id from a WhatsApp message id.
 *
 * @param {string} prefix "in" or "out".
 * @param {string} wamid Meta's id.
 * @return {string} Deterministic id.
 */
function messageDocId(prefix, wamid) {
  return `${prefix}_${crypto.createHash("sha1").update(String(wamid))
      .digest("hex").slice(0, 24)}`;
}

/**
 * The month key of a time, in New York.
 *
 * @param {number} ms Millis.
 * @return {string} "2026-10".
 */
function monthKey(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York",
    year: "numeric", month: "2-digit"}).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}`;
}

/**
 * Builds the conversation service.
 *
 * @param {object} deps {db, bucket, FieldValue, Timestamp, send(body),
 *   graphMedia(mediaId) -> {buffer, mimeType}, notifyConversation(conv,
 *   preview, opts), recordFailedUpdate(rowRef, row, error), shipmentQueries(),
 *   logger, now()}.
 * @return {object} The service.
 */
function createWhatsAppConversations(deps) {
  const {db, FieldValue, Timestamp, logger} = deps;
  const now = deps.now || (() => Date.now());
  const conversations = () => db.collection("supportCases");

  async function inboxMode() {
    const doc = await db.collection("appConfig").doc("whatsappInbox").get();
    const mode = doc.exists ? String(doc.data()?.mode || "") : "";
    return mode === wa.INBOX_MODE.BUSINESSES ?
      wa.INBOX_MODE.BUSINESSES : wa.INBOX_MODE.LAAWOL_ONLY;
  }

  async function isStopped(phone) {
    const e164 = wa.phoneFromWa(phone);
    if (!e164) return false;
    const doc = await db.collection("whatsappStops").doc(e164).get();
    return doc.exists && doc.data()?.stopped === true;
  }

  async function businessName(businessId) {
    if (!businessId || businessId === wa.LAAWOL_INBOX) return "Laawol";
    const doc = await db.collection("businesses").doc(businessId).get();
    return doc.exists ? String(doc.data()?.name || businessId) : businessId;
  }

  /**
   * Who last messaged this number, kept when a template is sent.
   *
   * @param {object} args {phone, businessId, businessName, trackingCode,
   *   name, template}.
   * @return {Promise<void>}
   */
  async function recordContact(args) {
    const e164 = wa.phoneFromWa(args?.phone);
    const businessId = String(args?.businessId || "");
    if (!e164 || !businessId) return;
    const atMs = now();
    await db.collection("whatsappContacts").doc(e164).set({
      phone: e164,
      businesses: {[businessId]: {
        businessName: String(args.businessName || ""),
        lastSentAtMs: atMs,
        ...(args.trackingCode ? {trackingCode: String(args.trackingCode)} : {}),
        ...(args.name ? {name: String(args.name).slice(0, 120)} : {}),
      }},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    await countTemplate(businessId, String(args.template || "update"), atMs);
  }

  async function countTemplate(inboxId, template, atMs = now()) {
    const inbox = String(inboxId || wa.LAAWOL_INBOX);
    const month = monthKey(atMs);
    await db.collection("whatsappTemplateCounts").doc(`${inbox}_${month}`)
        .set({
          businessId: inbox,
          month,
          count: FieldValue.increment(1),
          byTemplate: {[template.replace(/[^A-Za-z0-9_]/g, "_")]:
            FieldValue.increment(1)},
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
  }

  /**
   * The businesses that could own this number's message, with when each
   * last talked to it.
   *
   * @param {string} phone The number.
   * @param {object} contact Its whatsappContacts record.
   * @param {object} opts {allRecords}: also search every record type even
   *   when contacts or conversations already name businesses (hand-over).
   * @return {Promise<object[]>} Candidates for routeInbound.
   */
  async function routingCandidates(phone, contact, {allRecords = false} = {}) {
    const byId = new Map();
    const add = (businessId, name, atMs) => {
      if (!businessId) return;
      const prev = byId.get(businessId);
      byId.set(businessId, {businessId,
        businessName: name || prev?.businessName || "",
        lastSentAtMs: Math.max(prev?.lastSentAtMs || 0, atMs || 0)});
    };
    for (const [id, info] of Object.entries(contact?.businesses || {})) {
      add(id, info?.businessName, Number(info?.lastSentAtMs) || 0);
    }
    const convs = await conversations().where("whatsappPhone", "==", phone)
        .limit(20).get();
    for (const doc of convs.docs) {
      const c = doc.data() || {};
      const at = Number(c.lastActivityAtMs) || 0;
      if (c.businessId) {
        add(String(c.businessId), String(c.businessName || ""), at);
      } else if (Number(c.handedToLaawolAtMs) > 0 &&
          c.whatsappState !== wa.CONVERSATION_STATE.DONE) {
        // Only an explicit hand-over keeps a customer with Laawol.
        add(wa.LAAWOL_INBOX, "Laawol", at);
      }
    }
    if ((byId.size === 0 || allRecords) &&
        typeof deps.shipmentQueries === "function") {
      // Never messaged by a business we recorded: find who has their number.
      const sources = deps.shipmentQueries();
      const snaps = await Promise.all(sources.map((s) =>
        db.collection(s.collection).where(s.field, "==", phone).limit(5).get()
            .catch(() => null)));
      const ids = new Set();
      for (const snap of snaps) {
        for (const doc of snap?.docs || []) {
          const id = String(doc.data()?.businessId || "");
          if (id) ids.add(id);
        }
      }
      for (const id of ids) {
        if (!byId.has(id)) add(id, await businessName(id), 0);
      }
    }
    return Array.from(byId.values());
  }

  async function sendAndRecord(caseRef, conv, body, message) {
    const sent = await deps.send(body);
    const messageRef = caseRef.collection("messages").doc(
        sent.ok && sent.messageId ? messageDocId("out", sent.messageId) :
          caseRef.collection("messages").doc().id);
    const nowTs = FieldValue.serverTimestamp();
    await messageRef.set({
      ...message,
      metadata: {...(message.metadata || {}), channel: "whatsapp",
        whatsapp: {direction: "out", wamid: sent.messageId || "",
          status: sent.ok ? "sent" : "failed",
          error: sent.ok ? "" : String(sent.error || "").slice(0, 300)}},
      readBy: {}, deletedForUsers: {}, editHistory: [], replyTo: null,
      visibility: "case", createdAt: nowTs, updatedAt: nowTs,
    });
    if (sent.ok && sent.messageId) {
      await db.collection("whatsappMessages").doc(sent.messageId).set({
        path: messageRef.path, caseId: caseRef.id,
        createdAt: FieldValue.serverTimestamp()});
    }
    return {sent, messageRef};
  }

  async function sendAuto(caseRef, conv, text) {
    if (!text) return null;
    const body = wa.freeFormBody({phone: conv.whatsappPhone, text});
    if (!body) return null;
    return sendAndRecord(caseRef, conv, body, {
      senderId: "whatsapp:auto", senderRole: "system",
      senderName: "Automatic reply", senderProfileImageUrl: "",
      content: text, messageType: "system", metadata: {auto: true},
    });
  }

  /**
   * Stores a received file in our bucket.
   *
   * @param {string} caseId The conversation.
   * @param {object} event The received message.
   * @return {Promise<object>} {fileUrl, filePath, mimeType, fileSize} or
   *   {mediaError}.
   */
  async function storeMedia(caseId, event) {
    if (!event.media?.id || !deps.bucket || !deps.graphMedia) {
      return {mediaError: "File not available"};
    }
    try {
      const {buffer, mimeType} = await deps.graphMedia(event.media.id);
      if (!buffer || buffer.length > MAX_MEDIA_BYTES) {
        return {mediaError: "File too large"};
      }
      const mime = String(mimeType || event.media.mimeType || "")
          .split(";")[0].trim() || "application/octet-stream";
      const ext = (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "")
          .slice(0, 8) || "bin";
      const safeName = String(event.media.fileName || "")
          .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
      const filePath = `support_cases/${caseId}/whatsapp/` +
        `${messageDocId("in", event.wamid)}${safeName ? "_" + safeName :
          "." + ext}`;
      const token = crypto.randomUUID();
      await deps.bucket.file(filePath).save(buffer, {
        contentType: mime,
        resumable: false,
        metadata: {metadata: {firebaseStorageDownloadTokens: token}},
      });
      const fileUrl = "https://firebasestorage.googleapis.com/v0/b/" +
        `${deps.bucket.name}/o/${encodeURIComponent(filePath)}` +
        `?alt=media&token=${token}`;
      await db.collection("whatsappMedia").add({filePath, caseId,
        messageId: messageDocId("in", event.wamid), createdAtMs: now()});
      return {fileUrl, filePath, mimeType: mime, fileSize: buffer.length,
        fileName: event.media.fileName || ""};
    } catch (error) {
      logger?.warn?.("WhatsApp media download failed", {
        wamid: event.wamid, error: String(error).slice(0, 300)});
      return {mediaError: "The file could not be downloaded"};
    }
  }

  /**
   * Adds a received message to a conversation, creating it when needed.
   *
   * @return {Promise<{caseRef, conv, isNew: boolean, previous: object}>}
   */
  async function appendInbound({inboxId, inboxName, suggested, event, lang,
    state, extra}) {
    const caseId = wa.conversationId(inboxId, event.from);
    const caseRef = conversations().doc(caseId);
    const media = event.media ? await storeMedia(caseId, event) : null;
    const messageType = event.media ?
      wa.messageTypeForMime(event.media.mimeType, event.media.voice) : "text";
    const content = wa.previewText(messageType, event.text);
    const atMs = event.timestampMs || now();
    const isLaawol = inboxId === wa.LAAWOL_INBOX;
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(caseRef);
      const previous = snap.exists ? snap.data() || {} : null;
      const reopened = !previous ||
        previous.whatsappState === wa.CONVERSATION_STATE.DONE;
      const ts = Timestamp.fromMillis(atMs);
      const base = previous ? {} : {
        caseType: "whatsapp",
        channel: "whatsapp",
        inbox: inboxId,
        businessId: isLaawol ? "" : inboxId,
        businessName: inboxName,
        customerUid: "",
        customerPhone: event.from,
        whatsappPhone: event.from,
        relatedCollection: "whatsapp",
        relatedId: event.from,
        priority: "normal",
        escalationStatus: isLaawol ? "escalated" : "business_first",
        createdAt: FieldValue.serverTimestamp(),
      };
      const name = String(previous?.customerName || event.profileName ||
        event.from).slice(0, 120);
      tx.set(caseRef, {
        ...base,
        customerName: name,
        subject: name,
        relatedLabel: `${name} · ${event.from}`,
        ...(suggested ? {suggestedBusinessId: suggested.businessId,
          suggestedBusinessName: suggested.businessName} : {}),
        whatsappLang: lang,
        whatsappState: state || wa.CONVERSATION_STATE.NEEDS_REPLY,
        status: "waiting_for_business",
        lastMessage: content,
        lastMessageAt: ts,
        lastMessageSenderRole: "customer",
        lastCustomerMessageAt: ts,
        lastCustomerMessageAtMs: atMs,
        lastActivityAtMs: atMs,
        unreadCount: FieldValue.increment(1),
        ...(extra || {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      tx.set(caseRef.collection("messages").doc(messageDocId("in",
          event.wamid)), {
        senderId: `whatsapp:${event.from}`,
        senderRole: "customer",
        senderName: name,
        senderProfileImageUrl: "",
        content,
        messageType,
        metadata: {
          channel: "whatsapp",
          whatsapp: {direction: "in", wamid: event.wamid,
            type: event.type, replyToWamid: event.replyToWamid || ""},
          ...(media || {}),
          ...(event.media ? {caption: event.text || ""} : {}),
        },
        replyTo: null,
        visibility: "case",
        readBy: {},
        deletedForUsers: {},
        editHistory: [],
        createdAt: ts,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {previous: previous || {}, isNew: reopened};
    });
    const conv = {...result.previous, whatsappPhone: event.from,
      whatsappLang: lang, inbox: inboxId,
      businessId: isLaawol ? "" : inboxId, businessName: inboxName};
    return {caseRef, conv, isNew: result.isNew, previous: result.previous,
      preview: content};
  }

  /**
   * Sends the staff messages that waited for the customer to write.
   *
   * @param {object} caseRef The conversation.
   * @param {object} conv Its data.
   * @return {Promise<void>}
   */
  async function flushWaiting(caseRef, conv) {
    const waiting = await caseRef.collection("messages")
        .where("metadata.whatsapp.status", "==", "waiting_for_reply")
        .limit(20).get();
    const rows = waiting.docs.sort((a, b) =>
      (a.data().createdAt?.toMillis?.() || 0) -
      (b.data().createdAt?.toMillis?.() || 0));
    for (const doc of rows) {
      await deliverThreadMessage(caseRef, {...conv,
        lastCustomerMessageAtMs: now()}, doc.ref, doc.data(), {flush: true});
    }
  }

  async function trackingUrlFor(phone, businessId) {
    if (!businessId) return "";
    const contact = await db.collection("whatsappContacts").doc(phone).get();
    const code = String(contact.data()?.businesses?.[businessId]
        ?.trackingCode || "");
    return code ? TRACK_URL + encodeURIComponent(code) : "";
  }

  async function markStopped(phone, stopped) {
    await db.collection("whatsappStops").doc(phone).set({
      phone, stopped, atMs: now(), updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    const convs = await conversations().where("whatsappPhone", "==", phone)
        .limit(20).get();
    await Promise.all(convs.docs.map((doc) =>
      doc.ref.set({updatesStopped: stopped}, {merge: true})));
  }

  /**
   * One received message: dedupe, STOP/START, route, store, auto-reply,
   * send what was waiting, notify.
   *
   * @param {object} event From parseWebhook.
   * @return {Promise<string>} What happened (for logs and tests).
   */
  async function handleInbound(event) {
    const claim = db.collection("whatsappInbound").doc(event.wamid);
    try {
      await claim.create({from: event.from, type: event.type,
        receivedAtMs: now(), createdAt: FieldValue.serverTimestamp()});
    } catch (error) {
      if (error?.code === 6 || /already exists/i.test(String(error))) {
        return "duplicate";
      }
      throw error;
    }
    const phone = event.from;
    const contactRef = db.collection("whatsappContacts").doc(phone);
    const contact = (await contactRef.get()).data() || {};
    const lang = wa.detectLanguage(event.text, phone, contact.lang);
    const request = event.media ? "" : wa.stopOrStart(event.text);
    if (request) await markStopped(phone, request === "stop");
    await contactRef.set({phone, lang, lastInboundAtMs: now(),
      ...(event.profileName ? {profileName: event.profileName} : {}),
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});

    const mode = await inboxMode();
    // A pending "which business?" question.
    const choosing = contact.choosing && now() -
      (Number(contact.choosing.askedAtMs) || 0) < CHOOSING_TTL_MS ?
      contact.choosing : null;
    let inboxId = wa.LAAWOL_INBOX;
    let suggested = null;
    let outcome = "laawol";
    if (choosing && !request) {
      const pick = wa.choiceFromReply(event.text, choosing.options);
      if (!pick && (Number(choosing.attempts) || 0) < 2) {
        const held = await appendInbound({inboxId: wa.LAAWOL_INBOX,
          inboxName: "Laawol", event, lang,
          state: wa.CONVERSATION_STATE.CHOOSING});
        await contactRef.set({choosing: {attempts:
          (Number(choosing.attempts) || 0) + 1}}, {merge: true});
        await sendAuto(held.caseRef, held.conv, wa.autoReplyText({
          kind: "ask_again", lang, options: choosing.options}));
        return "asked_again";
      }
      await contactRef.set({choosing: FieldValue.delete()}, {merge: true});
      if (pick) {
        inboxId = pick;
        outcome = "picked";
        // What they wrote before choosing moves with them.
        await moveMessages(wa.conversationId(wa.LAAWOL_INBOX, phone),
            wa.conversationId(pick, phone), await businessName(pick),
            {reason: "picked"});
        // Their "1" itself is not worth a message in the thread.
        const target = conversations().doc(wa.conversationId(pick, phone));
        await deliverAutos(target, pick, phone, lang, {forceReceived: true});
        await notifyNew(target, "");
        return outcome;
      }
    } else if (mode === wa.INBOX_MODE.BUSINESSES) {
      const decision = wa.routeInbound({
        candidates: await routingCandidates(phone, contact),
        nowMs: now(), mode});
      if (decision.kind === "business") {
        inboxId = decision.businessId;
        outcome = "business";
      } else if (decision.kind === "ask" && !request) {
        const held = await appendInbound({inboxId: wa.LAAWOL_INBOX,
          inboxName: "Laawol", event, lang,
          state: wa.CONVERSATION_STATE.CHOOSING});
        await contactRef.set({choosing: {options: decision.options.map((o) =>
          ({businessId: o.businessId, businessName: o.businessName})),
        askedAtMs: now(), attempts: 0}}, {merge: true});
        await sendAuto(held.caseRef, held.conv, wa.autoReplyText({
          kind: "ask", lang, options: decision.options}));
        return "asked";
      }
    } else {
      // Launch week: everything to Laawol, remembering whose it would be.
      const decision = wa.routeInbound({
        candidates: await routingCandidates(phone, contact),
        nowMs: now(), mode});
      if (decision.kind === "business" &&
          decision.businessId !== wa.LAAWOL_INBOX) {
        suggested = {businessId: decision.businessId,
          businessName: await businessName(decision.businessId)};
      }
    }
    const inboxName = await businessName(inboxId);
    const added = await appendInbound({inboxId, inboxName, suggested, event,
      lang});
    if (request) {
      await sendAuto(added.caseRef, added.conv, wa.autoReplyText({
        kind: request === "stop" ? "stopped" : "started", lang}));
    } else {
      await deliverAutos(added.caseRef, inboxId, phone, lang, {
        isNew: added.isNew, previous: added.previous});
    }
    await flushWaiting(added.caseRef, added.conv);
    await notifyNew(added.caseRef, added.preview);
    return outcome;
  }

  async function deliverAutos(caseRef, inboxId, phone, lang,
      {isNew = false, previous = {}, forceReceived = false} = {}) {
    const snap = await caseRef.get();
    const conv = snap.data() || {};
    const autos = conv.autoReplies || previous.autoReplies || {};
    const t = now();
    if (inboxId === wa.LAAWOL_INBOX) {
      if (isNew || forceReceived) {
        await sendAuto(caseRef, conv, wa.autoReplyText({kind: "laawol", lang}));
        await caseRef.set({autoReplies: {receivedAtMs: t}}, {merge: true});
      }
      return;
    }
    const businessDoc = await db.collection("businesses").doc(inboxId).get();
    const business = businessDoc.data() || {};
    const settings = business.packageRequestSettings || {};
    const open = wa.isOpenNow(settings.openingHours,
        settings.timeZone || business.timeZone || "America/New_York", t);
    const trackingUrl = await trackingUrlFor(phone, inboxId);
    const name = String(business.name || conv.businessName || "");
    if (open === false &&
        t - (Number(autos.closedAtMs) || 0) > CLOSED_REPLY_GAP_MS) {
      await sendAuto(caseRef, conv, wa.autoReplyText({kind: "closed", lang,
        businessName: name, trackingUrl}));
      await caseRef.set({autoReplies: {closedAtMs: t, receivedAtMs: t}},
          {merge: true});
      return;
    }
    if (forceReceived || (isNew &&
        t - (Number(autos.receivedAtMs) || 0) > RECEIVED_REPLY_GAP_MS)) {
      await sendAuto(caseRef, conv, wa.autoReplyText({kind: "received", lang,
        businessName: name, trackingUrl}));
      await caseRef.set({autoReplies: {receivedAtMs: t}}, {merge: true});
    }
  }

  async function notifyNew(caseRef, preview) {
    if (!deps.notifyConversation) return;
    const snap = await caseRef.get();
    if (!snap.exists) return;
    await deps.notifyConversation({id: snap.id, ...snap.data()},
        preview || String(snap.data()?.lastMessage || ""))
        .catch((error) => logger?.warn?.("WhatsApp notify failed",
            {caseId: snap.id, error: String(error).slice(0, 200)}));
  }

  /**
   * Copies a conversation's messages into another inbox's conversation and
   * closes the source (a hand-over, or the customer's pick).
   *
   * @param {string} sourceId The conversation handed over.
   * @param {string} targetId The receiving conversation.
   * @param {string} targetName Who receives it.
   * @param {object} opts {reason, byName, note}.
   * @return {Promise<{targetId: string}>}
   */
  async function moveMessages(sourceId, targetId, targetName,
      {reason = "handoff", byName = "", note = ""} = {}) {
    if (sourceId === targetId) return {targetId};
    const sourceRef = conversations().doc(sourceId);
    const targetRef = conversations().doc(targetId);
    const source = await sourceRef.get();
    if (!source.exists) return {targetId};
    const src = source.data() || {};
    const inbox = targetId.replace(/^wa_/, "").replace(/_\d+$/, "");
    const isLaawol = inbox === wa.LAAWOL_INBOX;
    const messages = await sourceRef.collection("messages")
        .orderBy("createdAt", "asc").limit(300).get();
    const target = await targetRef.get();
    const base = target.exists ? {} : {
      caseType: "whatsapp", channel: "whatsapp", inbox,
      businessId: isLaawol ? "" : inbox, businessName: targetName,
      customerUid: "", customerPhone: src.whatsappPhone,
      whatsappPhone: src.whatsappPhone, relatedCollection: "whatsapp",
      relatedId: src.whatsappPhone, priority: "normal",
      escalationStatus: isLaawol ? "escalated" : "business_first",
      customerName: src.customerName || src.whatsappPhone,
      subject: src.customerName || src.whatsappPhone,
      relatedLabel: src.relatedLabel || src.whatsappPhone,
      createdAt: FieldValue.serverTimestamp(),
    };
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) await batch.commit();
      batch = db.batch();
      ops = 0;
    };
    for (const doc of messages.docs) {
      batch.set(targetRef.collection("messages").doc(doc.id), doc.data());
      ops += 1;
      if (ops >= 400) await flush();
    }
    const fromLabel = String(src.businessName || "Laawol");
    const text = reason === "picked" ?
      "The customer chose this business." :
      `Handed over from ${fromLabel}${byName ? " by " + byName : ""}.` +
        (note ? ` ${note}` : "");
    batch.set(targetRef.collection("messages").doc(), {
      senderId: "whatsapp:system", senderRole: "system",
      senderName: "Laawol", senderProfileImageUrl: "", content: text,
      messageType: "system", metadata: {note: true, handoff: true},
      replyTo: null, visibility: "case", readBy: {}, deletedForUsers: {},
      editHistory: [], createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(targetRef, {
      ...base,
      whatsappLang: src.whatsappLang || "en",
      whatsappState: wa.CONVERSATION_STATE.NEEDS_REPLY,
      status: "waiting_for_business",
      lastMessage: src.lastMessage || text,
      lastMessageAt: src.lastMessageAt || FieldValue.serverTimestamp(),
      lastMessageSenderRole: src.lastMessageSenderRole || "customer",
      lastCustomerMessageAt: src.lastCustomerMessageAt || null,
      lastCustomerMessageAtMs: Number(src.lastCustomerMessageAtMs) || 0,
      lastActivityAtMs: now(),
      updatesStopped: src.updatesStopped === true,
      ...(isLaawol ? {handedToLaawolAtMs: now()} : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    batch.set(sourceRef, {
      whatsappState: wa.CONVERSATION_STATE.DONE,
      status: "resolved",
      handedTo: targetId,
      lastActivityAtMs: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    batch.set(sourceRef.collection("messages").doc(), {
      senderId: "whatsapp:system", senderRole: "system",
      senderName: "Laawol", senderProfileImageUrl: "",
      content: reason === "picked" ?
        `The customer chose ${targetName}.` : `Handed over to ${targetName}.`,
      messageType: "system", metadata: {note: true, handoff: true},
      replyTo: null, visibility: "case", readBy: {}, deletedForUsers: {},
      editHistory: [], createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await flush();
    return {targetId};
  }

  /**
   * Sends one staff message of a conversation to the customer, or holds it
   * for their reply (outside 24 hours) and sends the "you have a message"
   * template once.
   *
   * @param {object} caseRef The conversation.
   * @param {object} conv Its data.
   * @param {object} messageRef The thread message.
   * @param {object} message Its data.
   * @param {object} opts {flush}.
   * @return {Promise<string>} sent | waiting | stopped | failed | skipped.
   */
  async function deliverThreadMessage(caseRef, conv, messageRef, message,
      opts = {}) {
    const meta = message.metadata || {};
    if (meta.note === true || message.senderRole === "system" ||
        message.senderRole === "customer") {
      return "skipped";
    }
    const phone = conv.whatsappPhone;
    const label = String(meta.whatsappLabel || "");
    const setStatus = (status, extra = {}) => messageRef.set({metadata: {
      channel: "whatsapp", whatsapp: {direction: "out", status, ...extra}}},
    {merge: true});
    if (!wa.withinWindow(conv.lastCustomerMessageAtMs, now())) {
      await setStatus("waiting_for_reply");
      if (opts.flush) return "waiting";
      const t = now();
      if (t - (Number(conv.waitingTemplateAtMs) || 0) < wa.WINDOW_MS) {
        return "waiting";
      }
      if (await isStopped(phone)) {
        await setStatus("waiting_for_reply", {stopped: true});
        return "stopped";
      }
      const contact = (await db.collection("whatsappContacts").doc(phone)
          .get()).data() || {};
      const inbox = conv.businessId || wa.LAAWOL_INBOX;
      const reference = String(contact.businesses?.[inbox]?.trackingCode ||
        "");
      const body = wa.waitingTemplateBody({phone,
        name: String(conv.customerName || "").split(" ")[0],
        businessName: conv.businessName || "Laawol", reference});
      const sent = await deps.send(body);
      await caseRef.set({waitingTemplateAtMs: t,
        waitingTemplateError: sent.ok ? "" : String(sent.error || "")
            .slice(0, 300)}, {merge: true});
      if (sent.ok) await countTemplate(inbox, wa.WAITING_TEMPLATE, t);
      return sent.ok ? "waiting" : "failed";
    }
    const type = message.messageType || "text";
    let body;
    let extraText = "";
    if (type === "text") {
      body = wa.freeFormBody({phone, text: wa.signedText(label,
          message.content)});
    } else {
      const mime = String(meta.mimeType || "").split(";")[0].toLowerCase();
      let kind = wa.waKindForMessageType(type);
      if (kind === "audio" && !WA_AUDIO_TYPES.includes(mime)) kind = "document";
      const caption = wa.signedText(label, meta.caption || "");
      if (kind === "audio") extraText = wa.signedText(label, "🎤");
      body = wa.freeFormBody({phone, kind, link: meta.fileUrl,
        fileName: meta.fileName, caption: kind === "audio" ? "" : caption});
    }
    if (!body) {
      await setStatus("failed", {error: "Nothing to send"});
      return "failed";
    }
    if (extraText) {
      await deps.send(wa.freeFormBody({phone, text: extraText}));
    }
    const sent = await deps.send(body);
    if (!sent.ok && Number(sent.errorCode) === 131047) {
      // The window closed on Meta's side: hold it like any late message.
      await caseRef.set({lastCustomerMessageAtMs: 0}, {merge: true});
      return deliverThreadMessage(caseRef, {...conv,
        lastCustomerMessageAtMs: 0}, messageRef, message, opts);
    }
    await setStatus(sent.ok ? "sent" : "failed", {
      wamid: sent.messageId || "",
      error: sent.ok ? "" : String(sent.error || "").slice(0, 300)});
    if (sent.ok && sent.messageId) {
      await db.collection("whatsappMessages").doc(sent.messageId).set({
        path: messageRef.path, caseId: caseRef.id,
        createdAt: FieldValue.serverTimestamp()});
    }
    return sent.ok ? "sent" : "failed";
  }

  /**
   * Called after a staff or Laawol message is written to a WhatsApp
   * conversation (sendSupportMessage / uploadSupportAttachmentMetadata).
   *
   * @param {object} args {caseRef, messageRef, user, isAdmin}.
   * @return {Promise<string>} The delivery outcome.
   */
  async function relayStaffMessage({caseRef, messageRef, user, isAdmin}) {
    const [caseSnap, messageSnap] = await Promise.all([caseRef.get(),
      messageRef.get()]);
    if (!caseSnap.exists || !messageSnap.exists) return "skipped";
    const conv = caseSnap.data() || {};
    const message = messageSnap.data() || {};
    const label = wa.senderLabel({chatDisplayName: user?.chatDisplayName,
      fullName: user?.fullName || user?.displayName || "",
      isLaawol: Boolean(isAdmin), businessName: conv.businessName});
    await messageRef.set({senderName: label, metadata: {channel: "whatsapp",
      whatsappLabel: label}}, {merge: true});
    await caseRef.set({
      whatsappState: wa.CONVERSATION_STATE.WAITING_CUSTOMER,
      lastActivityAtMs: now(),
      unreadCount: 0,
    }, {merge: true});
    return deliverThreadMessage(caseRef, conv, messageRef,
        {...message, metadata: {...(message.metadata || {}),
          whatsappLabel: label}});
  }

  /**
   * A delivery status from Meta: ticks on our thread message, or on the
   * package update it belongs to.
   *
   * @param {object} st From parseWebhook.
   * @return {Promise<string>} thread | update | unknown.
   */
  async function handleStatus(st) {
    const index = await db.collection("whatsappMessages").doc(st.wamid).get();
    if (index.exists && index.data()?.path) {
      const ref = db.doc(index.data().path);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const current = snap.data()?.metadata?.whatsapp?.status || "";
        const next = wa.nextDeliveryStatus(current, st.status);
        if (next === current) return;
        tx.set(ref, {metadata: {whatsapp: {status: next,
          ...(next === "failed" ? {error: st.errorTitle ||
            `Error ${st.errorCode}`} : {}),
          statusAtMs: st.timestampMs || now()}}}, {merge: true});
      });
      return "thread";
    }
    const rows = await db.collection("containerUpdates")
        .where("whatsappMessageId", "==", st.wamid).limit(1).get();
    if (rows.empty) return "unknown";
    const rowRef = rows.docs[0].ref;
    let failedRow = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rowRef);
      if (!snap.exists) return;
      const row = snap.data() || {};
      const current = String(row.deliveryStatus || "");
      const next = wa.nextDeliveryStatus(current, st.status);
      if (next === current) return;
      tx.update(rowRef, {
        deliveryStatus: next,
        deliveryStatusAtMs: st.timestampMs || now(),
        ...(next === "failed" ? {deliveryError: st.errorTitle ||
          `Error ${st.errorCode}`, deliveryErrorCode: st.errorCode || 0} : {}),
      });
      if (next === "failed") failedRow = row;
    });
    if (failedRow && deps.recordFailedUpdate) {
      await deps.recordFailedUpdate(rowRef, failedRow,
          st.errorTitle || `Error ${st.errorCode}`);
    }
    return "update";
  }

  /**
   * Everything in one webhook call; one bad event does not stop the rest.
   *
   * @param {object} parsed From parseWebhook.
   * @return {Promise<object>} Counts.
   */
  async function handleWebhookEvents(parsed) {
    const tally = {messages: 0, statuses: 0, errors: 0};
    for (const st of parsed.statuses || []) {
      try {
        await handleStatus(st);
        tally.statuses += 1;
      } catch (error) {
        tally.errors += 1;
        logger?.error?.("WhatsApp status failed", {wamid: st.wamid,
          error: String(error).slice(0, 300)});
      }
    }
    for (const event of parsed.messages || []) {
      try {
        await handleInbound(event);
        tally.messages += 1;
      } catch (error) {
        tally.errors += 1;
        // Let the next delivery from Meta try again.
        await db.collection("whatsappInbound").doc(event.wamid).delete()
            .catch(() => {});
        logger?.error?.("WhatsApp message failed", {wamid: event.wamid,
          error: String(error).slice(0, 300)});
      }
    }
    return tally;
  }

  /**
   * Staff open (or create) the conversation with a customer from a package.
   *
   * @return {Promise<string>} The conversation id.
   */
  async function openConversation({inboxId, phone, name}) {
    const e164 = wa.phoneFromWa(phone);
    if (!e164) throw new Error("phone_required");
    const caseId = wa.conversationId(inboxId, e164);
    const ref = conversations().doc(caseId);
    const isLaawol = inboxId === wa.LAAWOL_INBOX;
    const inboxName = await businessName(inboxId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return;
      const label = String(name || e164).slice(0, 120);
      tx.set(ref, {
        caseType: "whatsapp", channel: "whatsapp", inbox: inboxId,
        businessId: isLaawol ? "" : inboxId, businessName: inboxName,
        customerUid: "", customerPhone: e164, whatsappPhone: e164,
        customerName: label, subject: label,
        relatedCollection: "whatsapp", relatedId: e164,
        relatedLabel: `${label} · ${e164}`, priority: "normal",
        escalationStatus: isLaawol ? "escalated" : "business_first",
        whatsappLang: wa.detectLanguage("", e164),
        whatsappState: wa.CONVERSATION_STATE.WAITING_CUSTOMER,
        status: "waiting_for_customer",
        lastMessage: "", lastCustomerMessageAtMs: 0, lastActivityAtMs: now(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return caseId;
  }

  async function setState(caseId, state) {
    const done = state === wa.CONVERSATION_STATE.DONE;
    await conversations().doc(caseId).set({
      whatsappState: state,
      status: done ? "resolved" : "waiting_for_business",
      ...(done ? {unreadCount: 0} : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  async function addNote(caseId, {text, user, isAdmin}) {
    const content = String(text || "").trim().slice(0, 2000);
    if (!content) throw new Error("note_required");
    const label = wa.senderLabel({chatDisplayName: user?.chatDisplayName,
      fullName: user?.fullName || "", isLaawol: Boolean(isAdmin),
      businessName: ""});
    const ref = conversations().doc(caseId).collection("messages").doc();
    await ref.set({
      senderId: String(user?.id || ""), senderRole: isAdmin ? "admin" :
        "business", senderName: label, senderProfileImageUrl: "",
      content, messageType: "text", metadata: {channel: "whatsapp",
        note: true},
      replyTo: null, visibility: "case", readBy: {}, deletedForUsers: {},
      editHistory: [], createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  /**
   * The customer's packages with one business, for the conversation header.
   *
   * @param {string} businessId The business.
   * @param {string} phone The customer's number.
   * @return {Promise<object[]>} Newest first, at most 20.
   */
  async function customerPackages(businessId, phone) {
    if (!businessId) return [];
    const [asSender, asReceiver] = await Promise.all([
      db.collection("containerLines").where("customerPhoneE164", "==", phone)
          .limit(30).get(),
      db.collection("containerLines").where("receiverPhoneE164", "==", phone)
          .limit(30).get(),
    ]);
    const seen = new Set();
    const out = [];
    for (const doc of [...asSender.docs, ...asReceiver.docs]) {
      const line = doc.data() || {};
      if (seen.has(doc.id) || line.businessId !== businessId) continue;
      seen.add(doc.id);
      out.push({
        id: doc.id,
        trackingCode: String(line.trackingCode || ""),
        kind: String(line.kind || ""),
        description: String(line.description || line.title ||
          line.vehicleLabel || "").slice(0, 120),
        containerId: String(line.containerId || ""),
        containerStatus: String(line.containerStatus || ""),
        destination: String(line.destinationCountryName ||
          line.destinationName || ""),
        role: line.customerPhoneE164 === phone ? "sender" : "receiver",
        createdAtMs: line.createdAt?.toMillis?.() || 0,
      });
    }
    out.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return out.slice(0, 20);
  }

  /**
   * Deletes stored files older than 12 months (text stays).
   *
   * @param {number} limit Files per run.
   * @return {Promise<number>} Files deleted.
   */
  async function sweepMedia(limit = 200) {
    if (!deps.bucket) return 0;
    const cutoff = now() - wa.MEDIA_RETENTION_MS;
    const old = await db.collection("whatsappMedia")
        .where("createdAtMs", "<", cutoff).limit(limit).get();
    let deleted = 0;
    for (const doc of old.docs) {
      const {filePath, caseId, messageId} = doc.data() || {};
      await deps.bucket.file(String(filePath)).delete()
          .catch(() => {});
      if (caseId && messageId) {
        await conversations().doc(caseId).collection("messages")
            .doc(messageId).set({metadata: {fileUrl: "", filePath: "",
              mediaDeleted: true}}, {merge: true}).catch(() => {});
      }
      await doc.ref.delete();
      deleted += 1;
    }
    return deleted;
  }

  return {
    inboxMode,
    isStopped,
    recordContact,
    countTemplate,
    routingCandidates,
    handleInbound,
    handleStatus,
    handleWebhookEvents,
    relayStaffMessage,
    deliverThreadMessage,
    openConversation,
    setState,
    addNote,
    moveMessages,
    customerPackages,
    sweepMedia,
    businessName,
  };
}

module.exports = {
  createWhatsAppConversations,
  messageDocId,
  monthKey,
  STOPPED_ERROR_CODE,
  WA_AUDIO_TYPES,
};
