"use strict";

/**
 * Business cards - the Firestore half (docs/BUSINESS_CARDS.md). One callable,
 * `businessCards`, routes on `data.action`, so the feature costs one Cloud
 * Run service:
 *
 *   get            anyone, no sign-in: what one card shows (a scan)
 *   list           the team: the business's cards, minting missing codes
 *   saveSettings   the owner: how the business's cards look
 *
 * Two server-only collections:
 *
 *   businessCards/{code}         {businessId, uid}; uid "" is the business's
 *                                own card. The code is the printed QR.
 *   businessCardOwners/{key}     {code}; key is `${businessId}_${uid}` (or
 *                                `_business`), so one person can never be
 *                                given two codes by two calls at once.
 *
 * Nothing is copied onto a card: every scan reads the person and the
 * business as they are now, so a changed number is right on every card
 * already printed, and a person who left shows the business alone.
 *
 * Everything Firebase-specific arrives through `deps`, so index.js keeps a
 * one-line export.
 */

const crypto = require("node:crypto");
const cards = require("./business_cards");

const CARDS = "businessCards";
const OWNERS = "businessCardOwners";
const TEAM_LIMIT = 300;
const MINT_ATTEMPTS = 8;
const NOT_FOUND = Object.freeze({version: 1, found: false});

/**
 * @param {object} deps Firebase handles and index.js helpers.
 * @return {object} The callable's handler.
 */
function createBusinessCardsHandlers(deps) {
  const {
    admin,
    HttpsError,
    logger,
    requireAuth,
    requireBusinessManager,
    hasBusinessPermission,
    accountAccessBlocked,
    normalizeBusinessServices,
    enforceCallableRateLimit,
  } = deps;
  const randomInt = deps.randomInt || ((max) => crypto.randomInt(max));
  const db = () => admin.firestore();
  const now = () => admin.firestore.FieldValue.serverTimestamp();

  const refuse = (status, message, reason) =>
    new HttpsError(status, message, {reason});

  const ownerKey = (businessId, uid) => `${businessId}_${uid || "business"}`;

  const requireBusinessId = (data) => {
    const businessId = String(data?.businessId || "").trim();
    if (!businessId || businessId.includes("/")) {
      throw refuse("invalid-argument", "businessId is required",
          "business_required");
    }
    return businessId;
  };

  const loadBusiness = async (businessId) => {
    const snap = await db().collection("businesses").doc(businessId).get();
    if (!snap.exists) {
      throw refuse("not-found", "Business not found", "business_not_found");
    }
    return snap.data() || {};
  };

  const servicesOf = (business) =>
    normalizeBusinessServices(business.enabledServices);

  /**
   * The people on a business's team today, the owner first.
   *
   * @param {string} businessId The business.
   * @param {object} business Its document.
   * @return {Promise<Array<{uid: string, user: object}>>} The team.
   */
  const teamOf = async (businessId, business) => {
    const ownerUid = String(business.ownerUid || "").trim();
    const snap = await db().collection("users")
        .where("businessId", "==", businessId)
        .where("role", "in", ["staff", "businessOwner"])
        .limit(TEAM_LIMIT).get();
    const people = new Map();
    for (const doc of snap.docs) {
      const user = doc.data() || {};
      if (accountAccessBlocked(user)) continue;
      people.set(doc.id, user);
    }
    if (ownerUid && !people.has(ownerUid)) {
      const owner = await db().collection("users").doc(ownerUid).get();
      if (owner.exists && !accountAccessBlocked(owner.data())) {
        people.set(ownerUid, owner.data() || {});
      }
    }
    return [...people.entries()]
        .map(([uid, user]) => ({uid, user}))
        .sort((a, b) => Number(b.uid === ownerUid) -
          Number(a.uid === ownerUid) ||
          cards.cardPersonName(a.user)
              .localeCompare(cards.cardPersonName(b.user)));
  };

  /**
   * The code of one card, minted the first time it is asked for.
   *
   * @param {string} businessId The business.
   * @param {string} uid The person, "" for the business's own card.
   * @param {string} byUid Who asked.
   * @return {Promise<string>} The code.
   */
  const codeFor = async (businessId, uid, byUid) => {
    const pointer = db().collection(OWNERS).doc(ownerKey(businessId, uid));
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const candidate = cards.buildCardCode(randomInt);
      try {
        return await db().runTransaction(async (tx) => {
          const held = await tx.get(pointer);
          const existing = cards.normalizeCardCode(held.data()?.code);
          if (existing) return existing;
          tx.create(db().collection(CARDS).doc(candidate), {
            businessId, uid: uid || "", createdAt: now(), createdBy: byUid});
          tx.set(pointer, {businessId, uid: uid || "", code: candidate,
            createdAt: now()});
          return candidate;
        });
      } catch (error) {
        // Only "that code is taken" is worth another try.
        if (error?.code !== 6 && error?.code !== "already-exists") {
          throw error;
        }
      }
    }
    throw refuse("unavailable", "Could not make a card. Try again.",
        "card_code_unavailable");
  };

  /**
   * A scan. No sign-in: the code is the capability, and the answer is an
   * allowlisted projection (business_cards.js publicCard), never a document.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} `{found: false}` or the card.
   */
  async function get(request) {
    await enforceCallableRateLimit(request,
        {name: "businessCardGet", limit: 60, windowSeconds: 60});
    const code = cards.normalizeCardCode(request.data?.code);
    if (!code) return NOT_FOUND;
    const card = await db().collection(CARDS).doc(code).get();
    if (!card.exists) return NOT_FOUND;
    const businessId = String(card.data()?.businessId || "");
    const uid = String(card.data()?.uid || "");
    if (!businessId) return NOT_FOUND;
    const snap = await db().collection("businesses").doc(businessId).get();
    const business = snap.exists ? snap.data() || {} : null;
    if (!business || String(business.status) !== "approved") {
      return NOT_FOUND;
    }
    let user = null;
    if (uid) {
      const person = await db().collection("users").doc(uid).get();
      const data = person.exists ? person.data() || {} : null;
      const ownerUid = String(business.ownerUid || "").trim();
      if (cards.isTeamMember(data, businessId, ownerUid, uid) &&
          !accountAccessBlocked(data)) {
        user = data;
      }
    }
    return {version: 1, found: true, card: cards.publicCard({
      code, businessId, business, services: servicesOf(business), user})};
  }

  /**
   * The business's cards for its console. The owner, an admin and staff who
   * may see People get every card; other staff get the business's card and
   * their own, since a card carries a colleague's own number.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} The business, its settings and the cards.
   */
  async function list(request) {
    const uid = requireAuth(request);
    const businessId = requireBusinessId(request.data);
    const caller = await requireBusinessManager(uid, businessId);
    const business = await loadBusiness(businessId);
    const seesAll = hasBusinessPermission(caller, "people");
    const team = (await teamOf(businessId, business))
        .filter((member) => seesAll || member.uid === uid);
    const rows = [{uid: "", user: null}, ...team];
    const codes = await Promise.all(rows.map((row) =>
      codeFor(businessId, row.uid, uid)));
    const services = servicesOf(business);
    return {
      version: 1,
      canEdit: caller.role === "admin" || caller.role === "businessOwner",
      settings: cards.normalizeCardSettings(business.card),
      cards: rows.map((row, index) => cards.publicCard({
        code: codes[index], businessId, business, services, user: row.user,
      })).map((card, index) => ({...card, uid: rows[index].uid,
        mine: rows[index].uid === uid})),
    };
  }

  /**
   * How the business's cards look. The owner's choice (or an admin's).
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} The saved settings.
   */
  async function saveSettings(request) {
    const uid = requireAuth(request);
    const businessId = requireBusinessId(request.data);
    const caller = await requireBusinessManager(uid, businessId);
    if (caller.role !== "admin" && caller.role !== "businessOwner") {
      throw refuse("permission-denied",
          "Only the business owner can change the card.", "owner_only");
    }
    await loadBusiness(businessId);
    const {settings, errors} =
      cards.cleanCardSettingsInput(request.data?.settings);
    if (errors.length) {
      throw new HttpsError("invalid-argument",
          "These card settings cannot be saved.", {reasons: errors});
    }
    await db().collection("businesses").doc(businessId).set({
      card: {...settings, updatedAt: now(), updatedBy: uid},
    }, {merge: true});
    logger.info("business card settings saved", {businessId, uid,
      style: settings.style});
    return {version: 1, settings};
  }

  const ACTIONS = {get, list, saveSettings};

  /**
   * @param {object} request The callable request.
   * @return {Promise<object>} The action's answer.
   */
  async function businessCards(request) {
    const action = String(request.data?.action || "");
    if (!Object.hasOwn(ACTIONS, action)) {
      throw refuse("invalid-argument", "Unknown action", "unknown_action");
    }
    return ACTIONS[action](request);
  }

  return {businessCards, ACTIONS: Object.keys(ACTIONS)};
}

module.exports = {CARDS, OWNERS, createBusinessCardsHandlers};
