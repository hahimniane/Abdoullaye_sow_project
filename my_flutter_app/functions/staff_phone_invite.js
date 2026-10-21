"use strict";

/**
 * Staff invited by phone (docs/STAFF_PHONE_INVITES.md).
 *
 * A business owner invites a person by their WhatsApp number instead of an
 * email. The person signs in with the normal phone code (WhatsApp, text as
 * the fallback), exactly like a customer, and accepting the invitation turns
 * THAT account (a customer one made from a shipment keeps its packages) into
 * the business's staff. Phone-code sign-in stays refused for owners, admins
 * and email-invited staff: the one exception is staff whose profile records
 * that they joined through a phone invitation of the number they sign in
 * with (`staffPhoneSignInAllowed`).
 *
 * The pure half is exported on its own and unit-tested
 * (test/staff-phone-invite.test.js); `createStaffPhoneInvites(deps)` builds
 * the Firestore/Auth half, driven by the emulator suite
 * (test/staff-phone-invite-callables.test.js). The invitations live in the
 * same server-only `accessInvitations` collection as email ones, with
 * `channel: "phone"`.
 */

const crypto = require("crypto");
const {
  STATUS: PHONE_STATUS,
  lastTwo,
  regionIsoForCountry,
  strictE164,
  toE164,
} = require("./phone_e164");
const {
  ACCESS_INVITATION_STATUS,
  accessInvitationExpiryMs,
  accessInvitationIsLive,
  accessInvitationStatus,
  maskedPhoneNumber,
} = require("./access_invitation");

const CHANNEL = Object.freeze({EMAIL: "email", PHONE: "phone"});

// The link the WhatsApp button and the "share this link" fallback carry. The
// app claims /j/ (Android intent filter, apple-app-site-association); without
// the app the customer console opens the same invitation page.
const STAFF_INVITE_LINK_BASE = "https://customer.laawoldigital.com/j/";
// 32 random bytes, base64url: 43 characters, like the /e/ estimate tokens.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// What the owner sees about the WhatsApp message.
const WHATSAPP_STATUS = Object.freeze({
  SENT: "sent",
  // The secrets are still the "unset" placeholder.
  NOT_CONFIGURED: "not_configured",
  // Meta refused the template itself: not approved yet, paused or disabled.
  TEMPLATE_PENDING: "template_pending",
  FAILED: "failed",
});

// Meta's answers that mean "this template cannot be sent (yet)":
// 132001 template does not exist in that language (still in review),
// 132015 template paused, 132016 template disabled.
const TEMPLATE_UNAVAILABLE_CODES = Object.freeze([132001, 132015, 132016]);

const cleanText = (value, max = 200) =>
  String(value ?? "").trim().slice(0, max);

/**
 * @param {object|null} invitation An accessInvitations document.
 * @return {"email"|"phone"} How it reaches the person. Documents written
 *   before phone invitations carry no channel: they are email ones.
 */
function invitationChannel(invitation) {
  return invitation?.channel === CHANNEL.PHONE ? CHANNEL.PHONE : CHANNEL.EMAIL;
}

/**
 * The document id of a phone invitation: one per number and business, and
 * never the id of an email invitation (whose key holds the email, with an
 * "@" no number has, and no "phone:" part).
 *
 * @param {string} e164 The number.
 * @param {string} businessId The business.
 * @return {string} 40 hex characters.
 */
function phoneInvitationId(e164, businessId) {
  return crypto.createHash("sha256")
      .update(`business:phone:${e164}:${businessId}`)
      .digest("hex")
      .slice(0, 40);
}

/**
 * @param {function(number): Buffer} random crypto.randomBytes (injectable).
 * @return {string} A new link token.
 */
function newInviteToken(random = crypto.randomBytes) {
  return random(32).toString("base64url");
}

/**
 * @param {*} value Anything.
 * @return {boolean} True for the shape of a link token.
 */
function isInviteToken(value) {
  return INVITE_TOKEN_PATTERN.test(String(value ?? ""));
}

/**
 * @param {*} token A link token.
 * @return {string} The invitation link, or "" for anything else.
 */
function staffInviteLink(token) {
  return isInviteToken(token) ? `${STAFF_INVITE_LINK_BASE}${token}` : "";
}

/**
 * The number as an owner's invitations list shows it.
 *
 * @param {*} e164 The number.
 * @return {string} "+224 ••••35", or "".
 */
function maskedPhone(e164) {
  const phone = strictE164(e164);
  return phone ? maskedPhoneNumber(phone) : "";
}

/**
 * Which way an invitation should go. Old clients send only an email, so
 * "email" stays the default.
 *
 * @param {object} data The callable's data.
 * @return {"email"|"phone"} The method.
 */
function inviteMethod(data) {
  return cleanText(data?.method, 20).toLowerCase() === CHANNEL.PHONE ?
    CHANNEL.PHONE : CHANNEL.EMAIL;
}

/**
 * A typed number, read the one way the server reads numbers (toE164).
 *
 * @param {*} raw The number as typed.
 * @param {string} regionIso The business's country (a NANP business may type
 *   ten digits).
 * @return {{ok: boolean, e164: string, reason: string}} reason is
 *   "phone-country-code-required" or "valid-phone-required" when not ok.
 */
function invitePhone(raw, regionIso = "") {
  const parsed = toE164(raw, {regionIso});
  if (parsed.status === PHONE_STATUS.OK) {
    return {ok: true, e164: parsed.e164, reason: ""};
  }
  return {ok: false, e164: "",
    reason: parsed.status === PHONE_STATUS.NEEDS_COUNTRY_CODE ?
      "phone-country-code-required" : "valid-phone-required"};
}

const STORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * "Which store?" on the invitation form: one store, or all of them. Applied
 * when the invitation is accepted, with the same effect as
 * setInventoryStaffAccess.
 *
 * @param {*} raw {allStores: boolean, homeStoreId?: string}, or nothing.
 * @return {{ok: boolean, access: ?{allStores: boolean,
 *   homeStoreId: string}}} access is null when no store was chosen.
 */
function normalizeInviteStoreAccess(raw) {
  if (raw === undefined || raw === null) return {ok: true, access: null};
  if (typeof raw !== "object" || Array.isArray(raw) ||
      typeof raw.allStores !== "boolean") {
    return {ok: false, access: null};
  }
  const homeStoreId = cleanText(raw.homeStoreId, 128);
  if (homeStoreId && !STORE_ID_PATTERN.test(homeStoreId)) {
    return {ok: false, access: null};
  }
  // One store must name it.
  if (!raw.allStores && !homeStoreId) return {ok: false, access: null};
  return {ok: true, access: {allStores: raw.allStores, homeStoreId}};
}

/**
 * What the owner is told after a send attempt. Never an error for the
 * callable: the invitation exists either way and its link works.
 *
 * @param {{configured: boolean, result: ?Object}} input Whether WhatsApp's
 *   secrets are real, and what sendWhatsApp answered.
 * @return {{whatsappStatus: string, whatsappSent: boolean, error: string,
 *   messageId: string}} The outcome.
 */
function inviteDeliveryOutcome({configured, result} = {}) {
  if (!configured) {
    return {whatsappStatus: WHATSAPP_STATUS.NOT_CONFIGURED,
      whatsappSent: false, error: "", messageId: ""};
  }
  if (result?.ok) {
    return {whatsappStatus: WHATSAPP_STATUS.SENT, whatsappSent: true,
      error: "", messageId: cleanText(result.messageId, 200)};
  }
  const code = Number(result?.errorCode) || 0;
  return {
    whatsappStatus: TEMPLATE_UNAVAILABLE_CODES.includes(code) ?
      WHATSAPP_STATUS.TEMPLATE_PENDING : WHATSAPP_STATUS.FAILED,
    whatsappSent: false,
    error: cleanText(result?.error, 300),
    messageId: "",
  };
}

/**
 * The phone-code sign-in exception (owner decision 2026-10): staff who
 * joined through a phone invitation sign in with the code of THAT number,
 * like a customer. Owners, platform admins, admin roles and staff who joined
 * by email are not covered (phone_accounts.phoneSignInAllowed refuses them).
 *
 * The marker (`signInMethod: "phone"`, `phoneInvite.phoneE164`) is written
 * only by acceptAccessInvitation (the rules let no client write either), and
 * removed whenever the person stops being staff.
 *
 * @param {object|null} profile users/{uid}.
 * @param {*} phone The number being signed in with.
 * @return {boolean} True when this phone may open this staff account.
 */
function staffPhoneSignInAllowed(profile, phone) {
  if (!profile || cleanText(profile.role, 40) !== "staff") return false;
  if (profile.platformAdmin === true || cleanText(profile.adminRole, 40)) {
    return false;
  }
  if (cleanText(profile.signInMethod, 20) !== CHANNEL.PHONE) return false;
  const e164 = strictE164(phone);
  const invited = strictE164(profile.phoneInvite?.phoneE164);
  return Boolean(e164) && invited === e164 &&
    Boolean(cleanText(profile.businessId, 128));
}

/**
 * The profile fields that mark a phone-invited staff member, written on
 * acceptance. `invitedName` is the name the owner typed in the invitation:
 * when the number already had an account under another name, that account
 * keeps its own name (one phone = one account) and the People card shows
 * "Invited as <invitedName>" so the owner still recognises who joined.
 *
 * @param {{invitationId: string, phoneE164: string, businessId: string,
 *   invitedName: (string|undefined)}} accepted What was accepted.
 * @param {*} acceptedAt A server timestamp.
 * @return {object} The fields.
 */
function phoneInviteMarker(
    {invitationId, phoneE164, businessId, invitedName}, acceptedAt) {
  return {
    signInMethod: CHANNEL.PHONE,
    phoneInvite: {
      invitationId: cleanText(invitationId, 160),
      phoneE164: strictE164(phoneE164),
      businessId: cleanText(businessId, 160),
      invitedName: cleanText(invitedName, 200),
      acceptedAt,
    },
  };
}

/**
 * What a removal cuts: a person who had business or platform authority and
 * no longer has it there. Their refresh tokens are revoked so the next token
 * refresh fails and the app and console sign them out.
 *
 * @param {{role: string, businessId: string}} before The profile before.
 * @param {{role: string, businessId: string}} after The profile after.
 * @return {boolean} True when sessions must be revoked.
 */
function accessRemoved(before, after) {
  const beforeRole = cleanText(before?.role, 40);
  const afterRole = cleanText(after?.role, 40);
  const businessRoles = ["staff", "businessOwner"];
  if (!businessRoles.includes(beforeRole) && beforeRole !== "admin") {
    return false;
  }
  if (afterRole === "customer" || !afterRole) return true;
  if (businessRoles.includes(beforeRole)) {
    if (!businessRoles.includes(afterRole)) return true;
    return cleanText(before?.businessId, 160) !==
      cleanText(after?.businessId, 160);
  }
  return false;
}

/**
 * What the invitation page (/j/<token>) may show to whoever holds the link:
 * who invited, to which business, and the last two digits of the number -
 * never the number.
 *
 * @param {string} id The invitation id.
 * @param {object} invitation The stored document.
 * @param {number} nowMs Now.
 * @return {object} The preview.
 */
function phoneInvitePreview(id, invitation, nowMs = Date.now()) {
  const record = invitation || {};
  const expires = record.expiresAt?.toMillis?.() ??
    (Number(record.expiresAtMs) || 0);
  return {
    invitationId: cleanText(id, 160),
    status: accessInvitationStatus(record, nowMs),
    businessId: cleanText(record.businessId, 160),
    businessName: cleanText(record.businessName),
    invitedByName: cleanText(record.invitedByName),
    fullName: cleanText(record.fullName),
    phoneLastTwo: lastTwo(record.phoneE164),
    expiresAtMs: Number(expires) || 0,
  };
}

/**
 * @param {Array<{id: string, data: object}>} entries Stored invitations.
 * @param {string} e164 A number.
 * @param {number} nowMs Now.
 * @return {Array<{id: string, data: object}>} The live phone invitations of
 *   exactly that number.
 */
function liveInvitesForPhone(entries, e164, nowMs = Date.now()) {
  const phone = strictE164(e164);
  if (!phone) return [];
  return (Array.isArray(entries) ? entries : []).filter((entry) =>
    invitationChannel(entry?.data) === CHANNEL.PHONE &&
    strictE164(entry?.data?.phoneE164) === phone &&
    accessInvitationIsLive(entry?.data, nowMs));
}

// ---------------------------------------------------------------------------
// Firebase half
// ---------------------------------------------------------------------------

/**
 * @param {object} deps {db, auth, FieldValue, Timestamp, logger, nowMs,
 *   countries, sendWhatsApp(body), whatsappConfigured(),
 *   inviteMessage(args), refuse(status, reason, message, details),
 *   audit(batchOrTransaction, entry)}.
 * @return {object} The handlers.
 */
function createStaffPhoneInvites(deps) {
  const db = () => deps.db();
  const auth = () => deps.auth();
  const now = () => (deps.nowMs ? deps.nowMs() : Date.now());
  const log = deps.logger || console;
  const refuse = deps.refuse;
  const collection = () => db().collection("accessInvitations");

  async function userById(uid) {
    try {
      return await auth().getUser(uid);
    } catch (error) {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    }
  }

  async function userByPhone(e164) {
    try {
      return await auth().getUserByPhoneNumber(e164);
    } catch (error) {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    }
  }

  /**
   * The account a number belongs to: its phoneAccountClaims uid when that
   * account still holds it (one phone = one account), else whoever Auth
   * says holds it.
   *
   * @param {string} e164 The number.
   * @return {Promise<?Object>} The Auth user, or null.
   */
  async function holderOf(e164) {
    const claim = await db().collection("phoneAccountClaims").doc(e164).get();
    const claimed = cleanText(claim.exists ? claim.data()?.uid : "", 160);
    if (claimed) {
      const user = await userById(claimed);
      if (user && strictE164(user.phoneNumber) === e164) return user;
    }
    return userByPhone(e164);
  }

  /**
   * "Which store?" from the form, checked against the business's stores
   * (email and phone invitations alike).
   *
   * @param {string} businessId The business.
   * @param {*} raw {allStores, homeStoreId} or nothing.
   * @return {Promise<?{allStores: boolean, homeStoreId: string}>} The access
   *   to apply on acceptance, or null.
   */
  async function storeAccessFor(businessId, raw) {
    const store = normalizeInviteStoreAccess(raw);
    if (!store.ok) {
      throw refuse("invalid-argument", "store-access-invalid",
          "Choose one store or all stores");
    }
    await checkStore(businessId, store.access);
    return store.access;
  }

  async function checkStore(businessId, access) {
    if (!access?.homeStoreId) return;
    const snap = await db().collection("inventoryStores")
        .doc(access.homeStoreId).get();
    const store = snap.exists ? snap.data() || {} : null;
    if (!store || cleanText(store.businessId, 160) !== businessId ||
        store.archived === true) {
      throw refuse("invalid-argument", "store-not-found",
          "Choose one of this business's stores");
    }
  }

  /**
   * Sends (or tries to send) the WhatsApp invitation and records what
   * happened on the invitation. Never throws.
   *
   * @param {object} ref The invitation document.
   * @param {object} invitation Its fields (phoneE164, fullName, ...).
   * @return {Promise<{whatsappStatus: string, whatsappSent: boolean}>} The
   *   outcome.
   */
  async function deliver(ref, invitation) {
    const configured = Boolean(deps.whatsappConfigured());
    let result = null;
    if (configured) {
      try {
        result = await deps.sendWhatsApp(deps.inviteMessage({
          phone: invitation.phoneE164,
          name: invitation.fullName,
          business: invitation.businessName,
          token: invitation.linkToken,
          locale: invitation.locale,
        }));
      } catch (error) {
        result = {ok: false, error: String(error?.message || error)};
      }
    }
    const outcome = inviteDeliveryOutcome({configured, result});
    try {
      await ref.set({
        lastWhatsAppStatus: outcome.whatsappStatus,
        lastWhatsAppError: outcome.error,
        lastWhatsAppMessageId: outcome.messageId,
        lastWhatsAppAt: deps.FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (error) {
      log.warn("Staff invitation delivery record failed", {
        invitationId: ref.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (outcome.whatsappStatus === WHATSAPP_STATUS.FAILED) {
      log.warn("Staff invitation WhatsApp not sent", {
        invitationId: ref.id, detail: outcome.error});
    }
    return {whatsappStatus: outcome.whatsappStatus,
      whatsappSent: outcome.whatsappSent};
  }

  /**
   * inviteBusinessMember with method "phone".
   *
   * @param {object} input {callerUid, actorRole, invitedByName, businessId,
   *   business, fullName, phone, locale, businessPermissions,
   *   inventoryStoreAccess}.
   * @return {Promise<object>} The callable's answer.
   */
  async function createInvitation(input) {
    const businessId = cleanText(input.businessId, 160);
    const business = input.business || {};
    const fullName = cleanText(input.fullName);
    if (!fullName) {
      throw refuse("invalid-argument", "full-name-required",
          "Enter the person's name");
    }
    const region = regionIsoForCountry(business.country ||
      business.countryCode, deps.countries);
    const parsed = invitePhone(input.phone, region);
    if (!parsed.ok) {
      throw refuse("invalid-argument", parsed.reason,
          parsed.reason === "phone-country-code-required" ?
            "Add the country code to the number" :
            "Enter a valid phone number");
    }
    const e164 = parsed.e164;
    const storeAccess = await storeAccessFor(businessId,
        input.inventoryStoreAccess);

    // The same conflict rule as an email invitation: an account with
    // business or platform access elsewhere is never taken over.
    const holder = await holderOf(e164);
    if (holder) {
      const profileSnap = await db().collection("users").doc(holder.uid).get();
      const role = cleanText(profileSnap.exists ?
        profileSnap.data()?.role : "", 40);
      if (role && role !== "customer") {
        throw refuse("failed-precondition", "existing-authority-conflict",
            "Remove the user's existing privileged access before inviting " +
            "them");
      }
    }

    const invitationId = phoneInvitationId(e164, businessId);
    const ref = collection().doc(invitationId);
    const previousSnap = await ref.get();
    const previous = previousSnap.exists ? previousSnap.data() || {} : {};
    if (previousSnap.exists && accessInvitationIsLive(previous, now())) {
      throw refuse("already-exists", "invitation-already-pending",
          "An active invitation already exists", {invitationId});
    }

    const nowMs = now();
    const expiresAtMs = accessInvitationExpiryMs(nowMs);
    const linkToken = newInviteToken();
    const invitation = {
      kind: "business",
      channel: CHANNEL.PHONE,
      email: "",
      phoneE164: e164,
      phoneLastTwo: lastTwo(e164),
      fullName,
      locale: cleanText(input.locale, 12) || "en",
      targetUid: holder?.uid || "",
      status: ACCESS_INVITATION_STATUS.PENDING,
      adminRole: "",
      businessId,
      businessName: cleanText(business.name),
      businessPermissions: Array.isArray(input.businessPermissions) ?
        input.businessPermissions : [],
      linkToken,
      createdAt: deps.Timestamp.fromMillis(nowMs),
      updatedAt: deps.Timestamp.fromMillis(nowMs),
      expiresAt: deps.Timestamp.fromMillis(expiresAtMs),
      invitedBy: input.callerUid,
      invitedByName: cleanText(input.invitedByName),
      sendCount: Number(previous.sendCount || 0) + 1,
    };
    if (storeAccess) invitation.inventoryStoreAccess = storeAccess;
    const batch = db().batch();
    batch.set(ref, invitation);
    deps.audit(batch, {
      action: "business_member_invited",
      actorUid: input.callerUid,
      actorRole: input.actorRole,
      targetCollection: "accessInvitations",
      targetId: invitationId,
      targetLabel: maskedPhone(e164),
      nextValue: `staff:${businessId}`,
      metadata: {channel: CHANNEL.PHONE},
    });
    await batch.commit();
    const delivery = await deliver(ref, invitation);
    return {
      success: true,
      invitationId,
      targetUid: invitation.targetUid,
      channel: CHANNEL.PHONE,
      email: "",
      phoneMasked: maskedPhone(e164),
      status: ACCESS_INVITATION_STATUS.PENDING,
      inviteLink: staffInviteLink(linkToken),
      expiresAtMs,
      ...delivery,
    };
  }

  /**
   * resendAccessInvitation for a phone invitation: a fresh seven days and
   * the WhatsApp message again. The link stays the same, so a link the owner
   * already shared keeps working.
   *
   * @param {object} input {ref, invitation, invitationId, callerUid,
   *   actorRole}.
   * @return {Promise<object>} The callable's answer.
   */
  async function resendInvitation(input) {
    const {ref, invitationId} = input;
    const invitation = {...input.invitation};
    const nowMs = now();
    const expiresAtMs = accessInvitationExpiryMs(nowMs);
    if (!isInviteToken(invitation.linkToken)) {
      invitation.linkToken = newInviteToken();
    }
    const batch = db().batch();
    batch.set(ref, {
      expiresAt: deps.Timestamp.fromMillis(expiresAtMs),
      status: ACCESS_INVITATION_STATUS.PENDING,
      linkToken: invitation.linkToken,
      updatedAt: deps.FieldValue.serverTimestamp(),
      sendCount: Number(invitation.sendCount || 0) + 1,
      lastSentBy: input.callerUid,
    }, {merge: true});
    deps.audit(batch, {
      action: "access_invitation_resent",
      actorUid: input.callerUid,
      actorRole: input.actorRole,
      targetCollection: "accessInvitations",
      targetId: invitationId,
      targetLabel: maskedPhone(invitation.phoneE164),
      metadata: {channel: CHANNEL.PHONE},
    });
    await batch.commit();
    const delivery = await deliver(ref, invitation);
    return {
      success: true,
      invitationId,
      channel: CHANNEL.PHONE,
      phoneMasked: maskedPhone(invitation.phoneE164),
      status: ACCESS_INVITATION_STATUS.PENDING,
      inviteLink: staffInviteLink(invitation.linkToken),
      expiresAtMs,
      ...delivery,
    };
  }

  /**
   * @param {*} token A link token.
   * @return {Promise<?{id: string, ref: object, data: object}>} The phone
   *   invitation it opens, or null.
   */
  async function findByToken(token) {
    if (!isInviteToken(token)) return null;
    const snap = await collection().where("linkToken", "==", String(token))
        .limit(2).get();
    const docs = snap.docs.filter((doc) =>
      invitationChannel(doc.data()) === CHANNEL.PHONE);
    if (docs.length !== 1) return null;
    return {id: docs[0].id, ref: docs[0].ref, data: docs[0].data() || {}};
  }

  /**
   * The live phone invitations of a number (one equality filter: no
   * composite index; status and expiry are decided in memory).
   *
   * @param {string} e164 The number.
   * @return {Promise<Array<{id: string, ref: object, data: object}>>} Them.
   */
  async function livePhoneInvitations(e164) {
    const phone = strictE164(e164);
    if (!phone) return [];
    const snap = await collection().where("phoneE164", "==", phone)
        .limit(20).get();
    const entries = snap.docs.map((doc) =>
      ({id: doc.id, ref: doc.ref, data: doc.data() || {}}));
    return liveInvitesForPhone(entries, phone, now());
  }

  return {
    createInvitation,
    deliver,
    findByToken,
    holderOf,
    livePhoneInvitations,
    resendInvitation,
    storeAccessFor,
  };
}

module.exports = {
  CHANNEL,
  INVITE_TOKEN_PATTERN,
  STAFF_INVITE_LINK_BASE,
  TEMPLATE_UNAVAILABLE_CODES,
  WHATSAPP_STATUS,
  accessRemoved,
  createStaffPhoneInvites,
  invitationChannel,
  invitePhone,
  inviteDeliveryOutcome,
  inviteMethod,
  isInviteToken,
  liveInvitesForPhone,
  maskedPhone,
  newInviteToken,
  normalizeInviteStoreAccess,
  phoneInvitationId,
  phoneInviteMarker,
  phoneInvitePreview,
  staffInviteLink,
  staffPhoneSignInAllowed,
};
