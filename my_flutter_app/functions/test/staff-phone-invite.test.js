"use strict";

// Staff invited by phone (docs/STAFF_PHONE_INVITES.md): the pure rules -
// the invitation id, the link, matching a number, the phone-code sign-in
// exception, the WhatsApp outcome and the message itself.

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  WHATSAPP_STATUS,
  accessRemoved,
  invitationChannel,
  inviteDeliveryOutcome,
  inviteMethod,
  invitePhone,
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
} = require("../staff_phone_invite");
const {phoneSignInAllowed} = require("../phone_accounts");
const {accessInvitationRow} = require("../access_invitation");
const {
  STAFF_INVITE_TEMPLATE,
  STAFF_INVITE_VARIABLES,
  staffInviteTemplateMessage,
} = require("../whatsapp_templates");

const NOW = Date.UTC(2026, 9, 20, 15, 0, 0);
const ts = (ms) => ({toMillis: () => ms});
const GN = "+224622123456";
const US = "+12025550123";

describe("the phone invitation id", () => {
  it("is one per number and business, and stable", () => {
    assert.equal(phoneInvitationId(GN, "biz-a"), phoneInvitationId(GN,
        "biz-a"));
    assert.notEqual(phoneInvitationId(GN, "biz-a"), phoneInvitationId(GN,
        "biz-b"));
    assert.notEqual(phoneInvitationId(GN, "biz-a"), phoneInvitationId(US,
        "biz-a"));
    assert.match(phoneInvitationId(GN, "biz-a"), /^[0-9a-f]{40}$/);
  });

  it("never collides with the email invitation id scheme", () => {
    // index.js invitationIdFor: sha256(`${kind}:${email}:${businessId}`).
    const crypto = require("crypto");
    const emailId = (email, businessId) => crypto.createHash("sha256")
        .update(`business:${email.toLowerCase()}:${businessId}`)
        .digest("hex").slice(0, 40);
    // The phone key is "business:phone:<e164>:<biz>". Only an "email" of
    // "phone:<e164>" would hash the same, and that is not an email (no "@"):
    // createAccessInvitation refuses it before any id is made.
    assert.equal(emailId(`phone:${GN}`, "biz-a"), phoneInvitationId(GN,
        "biz-a"));
    assert.equal(`phone:${GN}`.includes("@"), false);
    for (const email of ["a@b.co", `${GN}@x.co`, "phone@224.gn"]) {
      assert.notEqual(emailId(email, "biz-a"), phoneInvitationId(GN,
          "biz-a"));
    }
  });
});

describe("the invitation link", () => {
  it("is a 43-character base64url token on /j/", () => {
    const token = newInviteToken();
    assert.ok(isInviteToken(token), token);
    assert.equal(staffInviteLink(token),
        `https://customer.laawoldigital.com/j/${token}`);
    assert.notEqual(newInviteToken(), token);
  });

  it("refuses anything else", () => {
    for (const value of ["", "abc", "x".repeat(44), "a/b".padEnd(43, "c"),
      null, undefined]) {
      assert.equal(isInviteToken(value), false, String(value));
      assert.equal(staffInviteLink(value), "");
    }
  });
});

describe("reading the typed number and the method", () => {
  it("takes E.164 and a NANP business's ten digits", () => {
    assert.deepEqual(invitePhone("+224 622 12 34 56"),
        {ok: true, e164: GN, reason: ""});
    assert.deepEqual(invitePhone("(202) 555-0123", "US"),
        {ok: true, e164: US, reason: ""});
  });

  it("asks for the country code instead of guessing", () => {
    assert.equal(invitePhone("622123456", "GN").reason,
        "phone-country-code-required");
    assert.equal(invitePhone("2025550123", "").reason,
        "phone-country-code-required");
    assert.equal(invitePhone("hello").reason, "valid-phone-required");
    assert.equal(invitePhone("").reason, "valid-phone-required");
  });

  it("defaults to email for old clients", () => {
    assert.equal(inviteMethod({email: "a@b.co"}), "email");
    assert.equal(inviteMethod({method: "PHONE"}), "phone");
    assert.equal(inviteMethod({method: "sms"}), "email");
    assert.equal(invitationChannel({}), "email");
    assert.equal(invitationChannel({channel: "phone"}), "phone");
  });

  it("masks the number for lists", () => {
    assert.equal(maskedPhone(GN), "+224 ••••56");
    assert.equal(maskedPhone(US), "+1 ••••23");
    assert.equal(maskedPhone("622123456"), "");
  });
});

describe("which store", () => {
  it("is all stores, one named store, or nothing", () => {
    assert.deepEqual(normalizeInviteStoreAccess(undefined),
        {ok: true, access: null});
    assert.deepEqual(normalizeInviteStoreAccess({allStores: true}),
        {ok: true, access: {allStores: true, homeStoreId: ""}});
    assert.deepEqual(normalizeInviteStoreAccess({allStores: false,
      homeStoreId: "store-2"}),
    {ok: true, access: {allStores: false, homeStoreId: "store-2"}});
  });

  it("refuses one store without a store, or a malformed one", () => {
    for (const raw of [{allStores: false}, {allStores: "yes"}, [], "all",
      {allStores: false, homeStoreId: "a/b"}]) {
      assert.equal(normalizeInviteStoreAccess(raw).ok, false,
          JSON.stringify(raw));
    }
  });
});

describe("the WhatsApp outcome", () => {
  it("is never an error, and says why nothing went out", () => {
    assert.equal(inviteDeliveryOutcome({configured: false}).whatsappStatus,
        WHATSAPP_STATUS.NOT_CONFIGURED);
    assert.deepEqual(inviteDeliveryOutcome({configured: true,
      result: {ok: true, messageId: "wamid.1"}}),
    {whatsappStatus: "sent", whatsappSent: true, error: "",
      messageId: "wamid.1"});
    for (const code of [132001, 132015, 132016]) {
      assert.equal(inviteDeliveryOutcome({configured: true,
        result: {ok: false, errorCode: code, error: "x"}}).whatsappStatus,
      WHATSAPP_STATUS.TEMPLATE_PENDING, String(code));
    }
    const failed = inviteDeliveryOutcome({configured: true,
      result: {ok: false, errorCode: 131026, error: "Undeliverable"}});
    assert.equal(failed.whatsappStatus, WHATSAPP_STATUS.FAILED);
    assert.equal(failed.whatsappSent, false);
    assert.equal(inviteDeliveryOutcome({configured: true, result: null})
        .whatsappStatus, WHATSAPP_STATUS.FAILED);
  });
});

describe("the phone-code sign-in exception", () => {
  const phoneStaff = {role: "staff", businessId: "biz-a",
    ...phoneInviteMarker({invitationId: "inv", phoneE164: GN,
      businessId: "biz-a"}, "now")};

  it("lets phone-invited staff in with the invited number only", () => {
    assert.equal(staffPhoneSignInAllowed(phoneStaff, GN), true);
    assert.equal(staffPhoneSignInAllowed(phoneStaff, US), false);
    assert.equal(staffPhoneSignInAllowed(phoneStaff, ""), false);
    assert.equal(phoneSignInAllowed(phoneStaff, {phone: GN}), true);
    // Linking passes no phone: never for staff.
    assert.equal(phoneSignInAllowed(phoneStaff), false);
  });

  it("keeps refusing owners, admins and email-invited staff", () => {
    const refused = {
      owner: {...phoneStaff, role: "businessOwner"},
      platformAdmin: {...phoneStaff, platformAdmin: true},
      adminRole: {...phoneStaff, adminRole: "supportAdmin"},
      admin: {...phoneStaff, role: "admin"},
      emailStaff: {role: "staff", businessId: "biz-a"},
      markerWithoutMethod: {...phoneStaff, signInMethod: ""},
      methodWithoutMarker: {role: "staff", businessId: "biz-a",
        signInMethod: "phone"},
      noBusiness: {...phoneStaff, businessId: ""},
    };
    for (const [name, profile] of Object.entries(refused)) {
      assert.equal(staffPhoneSignInAllowed(profile, GN), false, name);
      assert.equal(phoneSignInAllowed(profile, {phone: GN}), false, name);
    }
  });

  it("leaves customers exactly as before", () => {
    assert.equal(phoneSignInAllowed(null, {phone: GN}), true);
    assert.equal(phoneSignInAllowed({role: "customer"}, {phone: GN}), true);
    assert.equal(phoneSignInAllowed({role: "customer"}), true);
    assert.equal(phoneSignInAllowed({role: "customer",
      businessPermissions: ["sales"]}, {phone: GN}), false);
  });
});

describe("removal", () => {
  it("revokes when business or platform access is lost", () => {
    const staff = {role: "staff", businessId: "a"};
    assert.equal(accessRemoved(staff, {role: "customer", businessId: ""}),
        true);
    assert.equal(accessRemoved(staff, {role: "staff", businessId: "b"}),
        true);
    assert.equal(accessRemoved(staff, {role: "admin"}), true);
    assert.equal(accessRemoved({role: "admin"}, {role: "customer"}), true);
    assert.equal(accessRemoved({role: "businessOwner", businessId: "a"},
        {role: "customer"}), true);
  });

  it("keeps sessions for changes that keep access", () => {
    assert.equal(accessRemoved({role: "staff", businessId: "a"},
        {role: "staff", businessId: "a"}), false);
    assert.equal(accessRemoved({role: "staff", businessId: "a"},
        {role: "businessOwner", businessId: "a"}), false);
    assert.equal(accessRemoved({role: "customer"}, {role: "staff",
      businessId: "a"}), false);
    assert.equal(accessRemoved({role: "admin"}, {role: "admin"}), false);
  });
});

describe("matching a number to its invitations", () => {
  const live = {channel: "phone", phoneE164: GN, status: "pending",
    expiresAt: ts(NOW + 1000)};
  it("keeps only live phone invitations of exactly that number", () => {
    const entries = [
      {id: "a", data: live},
      {id: "b", data: {...live, status: "cancelled"}},
      {id: "c", data: {...live, expiresAt: ts(NOW - 1)}},
      {id: "d", data: {...live, phoneE164: US}},
      {id: "e", data: {...live, channel: "email"}},
      {id: "f", data: {...live, status: "accepted"}},
    ];
    assert.deepEqual(liveInvitesForPhone(entries, GN, NOW).map((e) => e.id),
        ["a"]);
    assert.deepEqual(liveInvitesForPhone(entries, "622123456", NOW), []);
  });

  it("previews without the number", () => {
    const preview = phoneInvitePreview("inv-1", {...live,
      businessId: "biz-a", businessName: "Dala Shipping",
      invitedByName: "Fatou", fullName: "Mamadou"}, NOW);
    assert.deepEqual(preview, {invitationId: "inv-1", status: "pending",
      businessId: "biz-a", businessName: "Dala Shipping",
      invitedByName: "Fatou", fullName: "Mamadou", phoneLastTwo: "56",
      expiresAtMs: NOW + 1000});
    assert.equal(JSON.stringify(preview).includes("622123456"), false);
    assert.equal(phoneInvitePreview("x", {...live,
      expiresAt: ts(NOW - 1)}, NOW).status, "expired");
  });
});

describe("the invitations list row", () => {
  it("shows a phone invitation masked, with its link and delivery", () => {
    const token = "a".repeat(43);
    const row = accessInvitationRow("inv", {kind: "business",
      channel: "phone", email: "", phoneE164: GN, fullName: "Mamadou",
      status: "pending", linkToken: token, lastWhatsAppStatus:
        "template_pending", expiresAt: ts(NOW + 1000),
      inventoryStoreAccess: {allStores: false, homeStoreId: "s1"}}, NOW);
    assert.equal(row.channel, "phone");
    assert.equal(row.phoneMasked, "+224 ••••56");
    assert.equal(row.phoneLastTwo, "56");
    assert.equal(row.inviteLink,
        `https://customer.laawoldigital.com/j/${token}`);
    assert.equal(row.whatsappStatus, "template_pending");
    assert.deepEqual(row.inventoryStoreAccess,
        {allStores: false, homeStoreId: "s1"});
    assert.equal(JSON.stringify(row).includes("622123456"), false);
  });

  it("keeps an email invitation as it was", () => {
    const row = accessInvitationRow("inv", {kind: "business",
      email: "A@B.co", status: "pending"}, NOW);
    assert.equal(row.channel, "email");
    assert.equal(row.email, "a@b.co");
    assert.equal(row.phoneMasked, "");
    assert.equal(row.inviteLink, "");
    assert.equal(row.inventoryStoreAccess, null);
  });
});

describe("the staff_account_setup template (Meta library)", () => {
  it("sends the library template: name, access, /j/ button", () => {
    const token = "b".repeat(43);
    const body = staffInviteTemplateMessage({phone: GN, name: "Mamadou",
      business: "Dala   Shipping", token, locale: "en"});
    assert.equal(body.to, "224622123456");
    assert.equal(body.template.name, STAFF_INVITE_TEMPLATE);
    assert.equal(body.template.name, "staff_account_setup");
    assert.deepEqual(body.template.language, {code: "en_US"});
    assert.deepEqual(body.template.components[0].parameters
        .map((p) => p.text),
    ["Mamadou", "your staff access at Dala Shipping"]);
    assert.equal(STAFF_INVITE_VARIABLES.length,
        body.template.components[0].parameters.length);
    assert.deepEqual(body.template.components[1], {type: "button",
      sub_type: "url", index: "0", parameters: [{type: "text",
        text: token}]});
  });

  it("uses the French library version for a French invitation", () => {
    const body = staffInviteTemplateMessage({phone: GN, name: "Mamadou",
      business: "Dala Shipping", token: "t", locale: "fr-FR"});
    assert.deepEqual(body.template.language, {code: "fr"});
    assert.equal(body.template.components[0].parameters[1].text,
        "accès employé chez Dala Shipping");
  });

  it("falls back to English for a missing or unknown locale", () => {
    for (const locale of [undefined, "", "es", "EN"]) {
      const body = staffInviteTemplateMessage({phone: GN, token: "t",
        locale});
      assert.deepEqual(body.template.language, {code: "en_US"});
    }
  });

  it("never sends an empty or multi-line parameter", () => {
    for (const locale of ["en", "fr"]) {
      const body = staffInviteTemplateMessage({phone: GN, token: "t",
        name: "  ", business: "", locale});
      for (const parameter of body.template.components[0].parameters) {
        assert.ok(parameter.text.length > 0);
        assert.doesNotMatch(parameter.text, /[\r\n\t]/);
      }
    }
  });

  it("is documented under its own name", () => {
    const doc = readFileSync(path.join(__dirname, "..", "..", "..", "docs",
        "WHATSAPP_CONTAINER_UPDATES.md"), "utf8");
    const section = doc.slice(doc.indexOf("### `staff_account_setup`"));
    assert.ok(doc.includes("### `staff_account_setup`"));
    assert.match(section, /account_creation_confirmation_3/);
    assert.match(section, /create_staff_setup_template\.py/);
    assert.match(section, /customer\.laawoldigital\.com\/j\/\{\{1\}\}/);
  });
});
