"use strict";

/**
 * Business cards - the Firestore half (docs/BUSINESS_CARDS.md). One callable,
 * `businessCards`, routes on `data.action`, so the feature costs one Cloud
 * Run service:
 *
 *   get            anyone, no sign-in: what one card shows (a scan)
 *   list           the team: the business's cards, minting missing codes
 *   saveSettings   the owner: how the business's cards look
 *   mine           the team: the signed-in person's own card and which
 *                  wallets are set up
 *   wallet         the team: a "Save to Google Wallet" link, or a ten-minute
 *                  link to the Apple pass (served by parkingDocument)
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
const wallet = require("./business_card_wallet");

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
  // Secret values (index.js reads them with safeSecretValue, so a project
  // without them reads as "not set up", never an error), the base of the
  // parkingDocument endpoint, and the clock.
  const secretValues = deps.walletSecrets || (() => ({}));
  const passLinkBase = deps.cardPassLinkBase ||
    (() => "https://laawoldigital.com/d");
  const clock = deps.nowMs || (() => Date.now());
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
    const card = await loadPublicCard(request.data?.code);
    return card ? {version: 1, found: true, card} : NOT_FOUND;
  }

  /**
   * One card as a scan sees it, or null. Shared by a scan and by the Apple
   * pass download, so a pass is always drawn from what the page shows.
   *
   * @param {*} rawCode The code as typed or scanned.
   * @return {Promise<?object>} The publicCard(), null when there is none.
   */
  async function loadPublicCard(rawCode) {
    const code = cards.normalizeCardCode(rawCode);
    if (!code) return null;
    const card = await db().collection(CARDS).doc(code).get();
    if (!card.exists) return null;
    const businessId = String(card.data()?.businessId || "");
    const uid = String(card.data()?.uid || "");
    if (!businessId) return null;
    const snap = await db().collection("businesses").doc(businessId).get();
    const business = snap.exists ? snap.data() || {} : null;
    if (!business || String(business.status) !== "approved") return null;
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
    return cards.publicCard({
      code, businessId, business, services: servicesOf(business), user});
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

  /**
   * The signed-in person's own card, for the app's "My card" screen. Any
   * member of a business's team (the owner or current staff): the card is
   * theirs, so it needs no permission beyond being on the team.
   *
   * @param {object} request The callable request.
   * @param {string} limitName The rate-limit bucket.
   * @return {Promise<object>} The person, their business and its document.
   */
  async function ownCard(request, limitName) {
    const uid = requireAuth(request);
    await enforceCallableRateLimit(request,
        {name: limitName, limit: 30, windowSeconds: 60});
    const snap = await db().collection("users").doc(uid).get();
    const user = snap.exists ? snap.data() || {} : null;
    const own = String(user?.businessId || "").trim();
    const asked = String(request.data?.businessId || "").trim();
    // A businessId may be sent, but it can only name the caller's own.
    if (!own || own.includes("/") || (asked && asked !== own)) {
      throw refuse("permission-denied", "This card is for a business's team.",
          "not_team_member");
    }
    const business = await loadBusiness(own);
    const ownerUid = String(business.ownerUid || "").trim();
    if (!cards.isTeamMember(user, own, ownerUid, uid) ||
        accountAccessBlocked(user)) {
      throw refuse("permission-denied", "This card is for a business's team.",
          "not_team_member");
    }
    return {uid, user, businessId: own, business};
  }

  const walletReady = () => wallet.walletConfig(secretValues());

  /**
   * `{code, url, card, wallet}` for the caller's own card. The code is made
   * the first time, by the same race-safe mint as the console's list.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} The card and which wallets are set up.
   */
  async function mine(request) {
    const {uid, user, businessId, business} =
      await ownCard(request, "businessCardMine");
    const code = await codeFor(businessId, uid, uid);
    const ready = walletReady();
    return {
      version: 1,
      code,
      url: cards.CARD_LINK_BASE + code,
      card: cards.publicCard({code, businessId, business,
        services: servicesOf(business), user}),
      wallet: {apple: Boolean(ready.apple), google: Boolean(ready.google)},
    };
  }

  /**
   * The link that adds the caller's card to a wallet. Google: the signed
   * "Save" URL. Apple: a ten-minute link to the pass, which parkingDocument
   * (view=card-pass) signs and serves; the app opens it in the browser.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} `{platform, url}`.
   */
  async function walletLink(request) {
    const platform = String(request.data?.platform || "");
    if (platform !== "apple" && platform !== "google") {
      throw refuse("invalid-argument", "platform must be apple or google",
          "platform_invalid");
    }
    const {uid, user, businessId, business} =
      await ownCard(request, "businessCardWallet");
    const ready = walletReady();
    const config = ready[platform];
    if (!config) {
      throw refuse("failed-precondition",
          "Wallet cards are not set up yet.", "wallet_not_ready");
    }
    if (String(business.status) !== "approved") {
      throw refuse("failed-precondition",
          "The business is not approved yet.", "business_not_approved");
    }
    const code = await codeFor(businessId, uid, uid);
    if (platform === "google") {
      const card = cards.publicCard({code, businessId, business,
        services: servicesOf(business), user});
      return {version: 1, platform,
        url: wallet.buildGoogleSaveUrl(config, card, clock())};
    }
    const token = wallet.signCardPassToken(config.keyPem, code, clock());
    const query = new URLSearchParams({view: "card-pass", t: token});
    return {version: 1, platform,
      url: `${passLinkBase()}?${query.toString()}`,
      expiresInSeconds: wallet.PASS_LINK_TTL_SECONDS};
  }

  /**
   * The pass a ten-minute link opens (called by parkingDocument, which owns
   * the public URL). Null for anything wrong: not set up, a bad or expired
   * link, a card that no longer shows (unapproved business).
   *
   * @param {string} token The `t` of the link.
   * @param {function} fetchImpl `fetch`, injectable.
   * @return {Promise<?{bytes: Buffer, filename: string}>} The pkpass.
   */
  async function cardPassFile(token, fetchImpl) {
    const {apple} = walletReady();
    if (!apple) return null;
    const claims = wallet.verifyCardPassToken(apple.keyPem, token, clock());
    if (!claims) return null;
    const card = await loadPublicCard(claims.c);
    if (!card) return null;
    const bytes = await wallet.buildApplePass({card, config: apple,
      fetchImpl});
    return {bytes, filename: `laawol-card-${card.code}.pkpass`};
  }

  /**
   * A card's logo for the website's "Share card" picture (docs/
   * BUSINESS_CARDS.md "Share as a picture"): the browser may only draw an
   * image into a picture when its host allows it, and storage does not, so
   * the logo is passed through here. Only a card the public page would show,
   * only its business's own logo, only a PNG or JPEG under 2 MB.
   *
   * @param {string} code The card's code.
   * @param {function=} fetchImpl `fetch`, injectable.
   * @return {Promise<?{bytes: Buffer, contentType: string}>} Or null.
   */
  async function cardLogoFile(code, fetchImpl) {
    const card = await loadPublicCard(code);
    const url = card?.business?.logoUrl;
    if (!url) return null;
    const bytes = await wallet.fetchWalletImage(url, fetchImpl);
    if (!bytes) return null;
    return {bytes, contentType: bytes[0] === 0x89 ? "image/png" : "image/jpeg"};
  }

  const ACTIONS = {get, list, saveSettings, mine, wallet: walletLink};

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

  return {businessCards, cardPassFile, cardLogoFile,
    ACTIONS: Object.keys(ACTIONS)};
}

module.exports = {CARDS, OWNERS, createBusinessCardsHandlers};
