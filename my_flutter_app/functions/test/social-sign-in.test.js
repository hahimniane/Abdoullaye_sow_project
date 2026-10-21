"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  createSocialSignIn,
  socialCustomerProfile,
  socialProviderOf,
} = require("../social_sign_in");

const FieldValue = {serverTimestamp: () => "<now>"};

/**
 * A users collection in memory, with Firestore's create() semantics.
 *
 * @param {object} initial Profiles by uid.
 * @return {object} The fake db.
 */
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const writes = [];
  return {
    docs,
    writes,
    collection(name) {
      assert.equal(name, "users");
      return {
        doc(id) {
          return {
            async get() {
              return {exists: docs.has(id), data: () => docs.get(id)};
            },
            async create(data) {
              if (docs.has(id)) {
                const error = new Error("ALREADY_EXISTS");
                error.code = 6;
                throw error;
              }
              writes.push({id, data});
              docs.set(id, data);
            },
          };
        },
      };
    },
  };
}

function handler({db, user, invitations = []}) {
  const calls = {pending: []};
  const {completeSocialSignIn} = createSocialSignIn({
    db: () => db,
    auth: () => ({getUser: async () => user}),
    FieldValue,
    defaultNotificationPreferences: () => ({orders: true}),
    pendingInvitationsFor: async (...args) => {
      calls.pending.push(args);
      return invitations;
    },
    normalizePhone: (phone) => phone.replace(/\D/g, ""),
    logger: {error() {}},
  });
  return {completeSocialSignIn, calls};
}

const googleUser = {
  uid: "u1",
  email: "Ada@Example.com",
  emailVerified: true,
  displayName: "Ada Lovelace",
  phoneNumber: undefined,
  providerData: [{providerId: "google.com"}],
};

function request(uid = "u1", provider = "google.com") {
  return {auth: {uid, token: {firebase: {sign_in_provider: provider}}}};
}

describe("socialProviderOf", () => {
  it("reads the token's provider, then the linked providers", () => {
    assert.equal(socialProviderOf({}, "apple.com"), "apple.com");
    assert.equal(socialProviderOf(googleUser, "password"), "google.com");
    assert.equal(
        socialProviderOf(
            {providerData: [{providerId: "password"}]}, "password"),
        "",
    );
  });
});

describe("socialCustomerProfile", () => {
  it("is always a plain customer, email lowercased", () => {
    const profile = socialCustomerProfile(
        {...googleUser, role: "admin", customClaims: {role: "admin"}},
        "google.com",
    );
    assert.deepEqual(profile, {
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      phone: "",
      role: "customer",
      signUpMethod: "google",
    });
  });

  it("keeps an Apple relay address and a missing name as given", () => {
    const profile = socialCustomerProfile(
        {email: "x@privaterelay.appleid.com", displayName: null},
        "apple.com",
    );
    assert.equal(profile.email, "x@privaterelay.appleid.com");
    assert.equal(profile.fullName, "");
    assert.equal(profile.signUpMethod, "apple");
  });
});

describe("completeSocialSignIn", () => {
  it("creates one customer profile for a new social account", async () => {
    const db = fakeDb();
    const {completeSocialSignIn} = handler({db, user: googleUser});
    const first = await completeSocialSignIn(request());
    assert.deepEqual(first, {profileCreated: true, invitationPending: false});
    const second = await completeSocialSignIn(request());
    assert.deepEqual(second, {profileCreated: false, invitationPending: false});
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].data.role, "customer");
    assert.equal(db.writes[0].data.email, "ada@example.com");
    assert.deepEqual(db.writes[0].data.notificationPreferences, {orders: true});
    assert.equal(db.writes[0].data.createdAt, "<now>");
    assert.equal("businessId" in db.writes[0].data, false);
  });

  it("never touches an existing account's profile", async () => {
    const staff = {role: "staff", businessId: "b1", businessName: "Shop"};
    const db = fakeDb({u1: staff});
    const {completeSocialSignIn, calls} = handler({db, user: googleUser});
    const answer = await completeSocialSignIn(request());
    assert.deepEqual(answer, {profileCreated: false, invitationPending: false});
    assert.equal(db.writes.length, 0);
    assert.deepEqual(db.docs.get("u1"), staff);
    assert.equal(calls.pending.length, 0);
  });

  it("leaves an invited person's profile to the invitation", async () => {
    const db = fakeDb();
    const {completeSocialSignIn, calls} = handler({
      db, user: googleUser, invitations: [{invitationId: "i1"}],
    });
    const answer = await completeSocialSignIn(request());
    assert.deepEqual(answer, {profileCreated: false, invitationPending: true});
    assert.equal(db.writes.length, 0);
    assert.deepEqual(calls.pending[0], ["u1", "ada@example.com", ""]);
  });

  it("does not look up invitations by an unverified email", async () => {
    const db = fakeDb();
    const {completeSocialSignIn, calls} = handler({
      db, user: {...googleUser, emailVerified: false},
    });
    await completeSocialSignIn(request());
    assert.equal(calls.pending[0][1], "");
  });

  it("refuses anonymous and non-social callers", async () => {
    const db = fakeDb();
    const {completeSocialSignIn} = handler({
      db, user: {...googleUser, providerData: [{providerId: "password"}]},
    });
    await assert.rejects(
        completeSocialSignIn(request("u1", "anonymous")),
        (error) => error.code === "unauthenticated",
    );
    await assert.rejects(
        completeSocialSignIn({auth: null}),
        (error) => error.code === "unauthenticated",
    );
    await assert.rejects(
        completeSocialSignIn(request("u1", "password")),
        (error) => error.code === "failed-precondition" &&
          error.details.reason === "not_social_sign_in",
    );
    assert.equal(db.writes.length, 0);
  });
});
