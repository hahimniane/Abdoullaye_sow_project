const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  guestRateLimitKeys,
  isAnonymousCaller,
  normalizeGuestPhone,
  parseGuestContact,
  resolveBookingContact,
} = require("../guest_contact");

const GUEST = Object.freeze({
  name: "  Mariama Diallo  ",
  email: "  Mariama@Example.COM ",
  phone: "(201) 555-0147",
});

const anonymousAuth = {
  uid: "anon-1",
  token: {firebase: {sign_in_provider: "anonymous", identities: {}}},
};

const passwordAuth = {
  uid: "real-1",
  token: {
    firebase: {
      sign_in_provider: "password",
      identities: {email: ["mariama@example.com"]},
    },
  },
};

describe("reading a guest's contact details", () => {
  it("trims and normalizes what the customer typed", () => {
    const parsed = parseGuestContact(GUEST);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.contact, {
      name: "Mariama Diallo",
      email: "mariama@example.com",
      // No country code was typed, so none is invented - the canonical
      // backend rule keeps what the customer entered.
      phone: "2015550147",
    });
  });

  it("names the field that failed rather than the form", () => {
    const cases = [
      [undefined, "guest_contact_missing"],
      [{email: "a@b.co", phone: "2015550147"}, "guest_name_missing"],
      [{name: "A", email: "not-an-email", phone: "2015550147"},
        "guest_email_invalid"],
      [{name: "A", email: "a@b.co", phone: "123"}, "guest_phone_invalid"],
    ];
    for (const [input, error] of cases) {
      assert.equal(parseGuestContact(input).error, error, String(error));
    }
  });

  it("keeps a leading plus and drops the rest of the formatting", () => {
    assert.equal(normalizeGuestPhone("+224 622 33 44 55"), "+224622334455");
    assert.equal(normalizeGuestPhone("201-555-0147"), "2015550147");
    // Too short to be a phone number, and too long to be one either.
    assert.equal(normalizeGuestPhone("55555"), "");
    assert.equal(normalizeGuestPhone("1".repeat(16)), "");
  });
});

describe("telling a guest from a customer", () => {
  it("reads the sign-in provider", () => {
    assert.equal(isAnonymousCaller(anonymousAuth), true);
    assert.equal(isAnonymousCaller(passwordAuth), false);
    assert.equal(isAnonymousCaller(null), false);
  });

  it("does not treat a verified-pending account as a guest", () => {
    // A real account can carry no email while verification is outstanding.
    // Reading that as "guest" would detach the booking from the account.
    const pending = {
      uid: "real-2",
      token: {firebase: {sign_in_provider: "password", identities: {}}},
    };
    assert.equal(isAnonymousCaller(pending), false);
  });
});

describe("deciding who a booking belongs to", () => {
  it("takes a guest's details from the payload", () => {
    const resolved = resolveBookingContact({
      auth: anonymousAuth, userRecord: {email: ""}, guest: GUEST,
    });
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.identity, {
      isGuest: true,
      customerEmail: "mariama@example.com",
      customerName: "Mariama Diallo",
      customerPhone: "2015550147",
      guestEmail: "mariama@example.com",
    });
  });

  it("refuses a guest booking with no way to reach the customer", () => {
    const resolved = resolveBookingContact({
      auth: anonymousAuth, userRecord: {}, guest: {name: "A"},
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.error, "guest_email_invalid");
  });

  it("ignores a guest block riding along on a signed-in booking", () => {
    // Otherwise a stale or spoofed block could redirect a real customer's
    // receipts to somebody else's inbox.
    const resolved = resolveBookingContact({
      auth: passwordAuth,
      userRecord: {email: "owner@example.com", displayName: "Owner"},
      guest: {name: "Attacker", email: "attacker@example.com", phone:
        "2015550100"},
    });
    assert.equal(resolved.identity.isGuest, false);
    assert.equal(resolved.identity.customerEmail, "owner@example.com");
    assert.equal("guestEmail" in resolved.identity, false);
  });
});

describe("rate limiting a guest", () => {
  it("counts against the email and the address, never the uid", () => {
    // An anonymous caller mints a new uid whenever it likes, so a per-uid
    // limit caps nobody at all.
    assert.deepEqual(
        guestRateLimitKeys({email: "A@B.co", ip: "203.0.113.7"}),
        ["email:a@b.co", "ip:203.0.113.7"],
    );
  });

  it("still limits on whichever signal it has", () => {
    assert.deepEqual(guestRateLimitKeys({ip: "203.0.113.7"}),
        ["ip:203.0.113.7"]);
    assert.deepEqual(guestRateLimitKeys({email: "bad", ip: ""}), []);
  });
});

describe("a guest who comes back", () => {
  const {storedGuestIdentity} = require("../guest_contact");

  it("is recognised from the profile their first booking wrote", () => {
    // The anonymous session outlives the app that made it; anything the
    // client held in memory does not. Without this the second booking asked
    // for details from a screen that no longer offers them, and payment
    // stopped there.
    assert.deepEqual(
        storedGuestIdentity({
          isGuest: true,
          email: "Mariama@Example.com",
          fullName: "Mariama Diallo",
          phone: "+12015550147",
        }),
        {
          isGuest: true,
          customerEmail: "mariama@example.com",
          customerName: "Mariama Diallo",
          customerPhone: "+12015550147",
          guestEmail: "mariama@example.com",
        },
    );
  });

  it("is not read off an account that is not a guest", () => {
    // A real customer's profile must never be used to fill a guest booking.
    assert.equal(storedGuestIdentity({
      isGuest: false, email: "real@example.com", fullName: "Real",
    }), null);
  });

  it("is nothing when the profile cannot reach them either", () => {
    for (const profile of [
      null,
      {isGuest: true},
      {isGuest: true, email: "nope", fullName: "A"},
      {isGuest: true, email: "a@b.co"},
    ]) {
      assert.equal(storedGuestIdentity(profile), null);
    }
  });
});
