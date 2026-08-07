"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  ACCESS_INVITATION_REFUSALS,
  ACCESS_INVITATION_TTL_MS,
  accessEmailDeliveryPlan,
  accessInvitationActionDecision,
  accessInvitationEmailCopy,
  accessInvitationExpiryMs,
  accessInvitationIsLive,
  accessInvitationRow,
  accessInvitationStatus,
  outstandingAccessInvitations,
  renderAccessInvitationEmail,
  renderAccessInvitationText,
} = require("../access_invitation");

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function timestamp(millis) {
  return {toMillis: () => millis};
}

function pending(overrides = {}) {
  return {
    kind: "business",
    email: "amina@example.com",
    fullName: "Amina Barry",
    status: "pending",
    businessId: "keren_auto_sales",
    businessName: "Keren Auto Sales",
    businessPermissions: ["parking", "listings"],
    invitedBy: "owner-uid",
    invitedByName: "Abdoullaye Sow",
    createdAt: timestamp(NOW - HOUR),
    updatedAt: timestamp(NOW - HOUR),
    expiresAt: timestamp(NOW + ACCESS_INVITATION_TTL_MS),
    sendCount: 1,
    ...overrides,
  };
}

describe("access invitation lifecycle", () => {
  it("a pending invitation expires once its window closes", () => {
    const invitation = pending({expiresAt: timestamp(NOW + HOUR)});
    assert.equal(accessInvitationStatus(invitation, NOW), "pending");
    assert.equal(accessInvitationIsLive(invitation, NOW), true);

    // One millisecond past the window it is dead, even though nothing swept
    // the collection and the stored status still reads "pending".
    assert.equal(invitation.status, "pending");
    assert.equal(
        accessInvitationStatus(invitation, NOW + HOUR + 1),
        "expired",
    );
    assert.equal(accessInvitationIsLive(invitation, NOW + HOUR + 1), false);
  });

  it("an invitation with no expiry recorded is treated as live", () => {
    assert.equal(
        accessInvitationStatus(pending({expiresAt: null}), NOW),
        "pending",
    );
  });

  it("accepted and cancelled outrank the clock", () => {
    const stale = {expiresAt: timestamp(NOW - HOUR)};
    assert.equal(
        accessInvitationStatus({...stale, status: "accepted"}, NOW),
        "accepted",
    );
    assert.equal(
        accessInvitationStatus({...stale, status: "cancelled"}, NOW),
        "cancelled",
    );
  });

  it("reads Timestamps, Dates, epochs, and ISO strings alike", () => {
    for (const expiresAt of [
      timestamp(NOW - HOUR),
      new Date(NOW - HOUR),
      NOW - HOUR,
      new Date(NOW - HOUR).toISOString(),
      {_seconds: (NOW - HOUR) / 1000},
      {seconds: (NOW - HOUR) / 1000},
    ]) {
      assert.equal(
          accessInvitationStatus(pending({expiresAt}), NOW),
          "expired",
      );
    }
  });

  it("resending re-issues a window rather than reusing the old one", () => {
    const first = accessInvitationExpiryMs(NOW);
    assert.equal(first, NOW + ACCESS_INVITATION_TTL_MS);
    const resentAt = NOW + ACCESS_INVITATION_TTL_MS + HOUR;
    const second = accessInvitationExpiryMs(resentAt);
    assert.ok(second > first, "a resent invitation must outlive the dead one");
    // The invitation was expired at the moment of the resend, and the fresh
    // window puts it back in front of the recipient.
    assert.equal(
        accessInvitationStatus(
            pending({expiresAt: timestamp(first)}),
            resentAt,
        ),
        "expired",
    );
    assert.equal(
        accessInvitationStatus(
            pending({expiresAt: timestamp(second)}),
            resentAt,
        ),
        "pending",
    );
  });
});

describe("cancel and resend decisions", () => {
  it("a pending invitation can be cancelled and resent", () => {
    for (const action of ["cancel", "resend"]) {
      const decision = accessInvitationActionDecision(pending(), action, NOW);
      assert.equal(decision.allowed, true);
      assert.equal(decision.reason, "");
      assert.equal(decision.status, "pending");
    }
  });

  it("an expired invitation stays cancellable and resendable", () => {
    const expired = pending({expiresAt: timestamp(NOW - HOUR)});
    for (const action of ["cancel", "resend"]) {
      const decision = accessInvitationActionDecision(expired, action, NOW);
      assert.equal(decision.allowed, true, `${action} should revive/clear it`);
      assert.equal(decision.status, "expired");
    }
  });

  it("an accepted invitation is refused for both actions", () => {
    const accepted = pending({status: "accepted"});
    for (const action of ["cancel", "resend"]) {
      const decision = accessInvitationActionDecision(accepted, action, NOW);
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, ACCESS_INVITATION_REFUSALS.ACCEPTED);
      assert.equal(decision.status, "accepted");
    }
  });

  it("an already cancelled invitation is refused for both actions", () => {
    const cancelled = pending({status: "cancelled"});
    for (const action of ["cancel", "resend"]) {
      const decision = accessInvitationActionDecision(cancelled, action, NOW);
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, ACCESS_INVITATION_REFUSALS.CANCELLED);
    }
  });

  it("an unknown action is refused even on a live invitation", () => {
    const decision = accessInvitationActionDecision(pending(), "delete", NOW);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, ACCESS_INVITATION_REFUSALS.UNKNOWN);
  });
});

describe("the pending list a People panel shows", () => {
  const entries = [
    {id: "live", data: pending({updatedAt: timestamp(NOW - HOUR)})},
    {
      id: "expired",
      data: pending({
        email: "old@example.com",
        expiresAt: timestamp(NOW - HOUR),
        updatedAt: timestamp(NOW - 5 * HOUR),
      }),
    },
    {id: "accepted", data: pending({
      email: "joined@example.com",
      status: "accepted",
    })},
    {id: "cancelled", data: pending({
      email: "dropped@example.com",
      status: "cancelled",
    })},
  ];

  it("an accepted invitation leaves the list", () => {
    const rows = outstandingAccessInvitations(entries, NOW);
    const ids = rows.map((row) => row.invitationId);
    assert.deepEqual(ids, ["live", "expired"]);
    assert.ok(!ids.includes("accepted"));
  });

  it("a cancelled invitation leaves the list", () => {
    const ids = outstandingAccessInvitations(entries, NOW)
        .map((row) => row.invitationId);
    assert.ok(!ids.includes("cancelled"));
  });

  it("an expired invitation stays, flagged, so it can be resent", () => {
    const rows = outstandingAccessInvitations(entries, NOW);
    const expired = rows.find((row) => row.invitationId === "expired");
    assert.equal(expired.status, "expired");
    assert.equal(expired.storedStatus, "pending");
  });

  it("the newest send is first", () => {
    const rows = outstandingAccessInvitations(entries, NOW);
    assert.ok(rows[0].sentAtMs >= rows[1].sentAtMs);
  });

  it("survives an empty or malformed input", () => {
    assert.deepEqual(outstandingAccessInvitations(null, NOW), []);
    assert.deepEqual(outstandingAccessInvitations([], NOW), []);
    const rows = outstandingAccessInvitations([{id: "x"}], NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "pending");
  });

  it("a row carries who, what, when, and by whom", () => {
    const row = accessInvitationRow("live", pending(), NOW);
    assert.equal(row.email, "amina@example.com");
    assert.equal(row.fullName, "Amina Barry");
    assert.equal(row.role, "staff");
    assert.equal(row.businessName, "Keren Auto Sales");
    assert.deepEqual(row.businessPermissions, ["parking", "listings"]);
    assert.equal(row.invitedByName, "Abdoullaye Sow");
    assert.equal(row.sentAtMs, NOW - HOUR);
    assert.equal(row.expiresAtMs, NOW + ACCESS_INVITATION_TTL_MS);
    assert.equal(row.sendCount, 1);
  });

  it("a platform invitation reports the admin role as its role", () => {
    const row = accessInvitationRow(
        "admin",
        pending({kind: "platform", adminRole: "financeAdmin", businessId: ""}),
        NOW,
    );
    assert.equal(row.kind, "platform");
    assert.equal(row.role, "financeAdmin");
  });
});

describe("which sender carries the invitation", () => {
  it("a connected Trigger Email sender carries the branded document", () => {
    const plan = accessEmailDeliveryPlan({
      emailProvider: "firebaseTriggerEmail",
      kind: "invitation",
    });
    assert.equal(plan.useTriggerEmail, true);
    assert.equal(plan.useFirebaseFallback, false);
    assert.equal(plan.branded, true);
    assert.equal(plan.status, "queued");
    assert.equal(plan.lastError, "");
  });

  it("with no sender connected an invitation falls back to Firebase", () => {
    const plan = accessEmailDeliveryPlan({
      emailProvider: "",
      kind: "invitation",
    });
    assert.equal(plan.useTriggerEmail, false);
    assert.equal(plan.useFirebaseFallback, true);
    // The branding is lost, the access is not - and the record says so.
    assert.equal(plan.branded, false);
    assert.equal(plan.provider, "firebaseAuth");
  });

  it("a password reset falls back the same way", () => {
    const plan = accessEmailDeliveryPlan({
      emailProvider: "none",
      kind: "password_reset",
    });
    assert.equal(plan.useFirebaseFallback, true);
    assert.equal(plan.provider, "firebaseAuth");
  });

  it("an email with no stock equivalent is recorded undeliverable", () => {
    const plan = accessEmailDeliveryPlan({
      emailProvider: "",
      kind: "verify_email",
    });
    assert.equal(plan.useTriggerEmail, false);
    assert.equal(plan.useFirebaseFallback, false);
    assert.equal(plan.status, "provider_not_configured");
    assert.match(plan.lastError, /not connected/);
  });
});

describe("the branded invitation email", () => {
  const links = {passwordResetLink: "https://laawol.test/set?oob=abc"};

  function copyFor(locale, overrides = {}) {
    return accessInvitationEmailCopy({
      locale,
      kind: "business",
      businessName: "Keren Auto Sales",
      inviterName: "Abdoullaye Sow",
      expiresAtMs: NOW + ACCESS_INVITATION_TTL_MS,
      actionUrl: links.passwordResetLink,
      ...overrides,
    });
  }

  it("names the inviter, the business, the task, and the expiry", () => {
    const copy = copyFor("en");
    assert.equal(copy.locale, "en");
    assert.match(copy.subject, /Keren Auto Sales/);
    assert.match(copy.sentence, /Abdoullaye Sow/);
    assert.match(copy.sentence, /Keren Auto Sales/);
    assert.match(copy.instruction, /password/i);
    assert.match(copy.expiryNote, /August 13, 2026/);
  });

  it("follows the recipient's locale into French", () => {
    const copy = copyFor("fr-FR");
    assert.equal(copy.locale, "fr");
    assert.match(copy.subject, /Rejoignez/);
    assert.match(copy.sentence, /vous invite/);
    assert.match(copy.buttonLabel, /mot de passe/);
    assert.match(copy.expiryNote, /13 août 2026/);
  });

  it("stays readable when nobody is named", () => {
    const copy = copyFor("en", {inviterName: "", businessName: ""});
    assert.match(copy.sentence, /You have been invited/);
    assert.match(copy.subject, /Laawol Digital/);
  });

  it("a platform invitation names the admin role, not a business", () => {
    const copy = copyFor("en", {
      kind: "platform",
      businessName: "",
      adminRoleLabel: "financeAdmin",
    });
    assert.match(copy.sentence, /financeAdmin/);
  });

  it("drops the expiry line rather than printing an empty date", () => {
    assert.equal(copyFor("en", {expiresAtMs: 0}).expiryNote, "");
    assert.doesNotMatch(
        renderAccessInvitationEmail(copyFor("en", {expiresAtMs: 0})),
        /expires/,
    );
  });

  it("renders the logo, one button, and the link", () => {
    const html = renderAccessInvitationEmail(copyFor("en"));
    assert.match(html, /laawoldigital\.com\/assets\/logo\.png/);
    assert.match(html, /#0D9488/);
    assert.equal((html.match(/<a href=/g) || []).length, 1);
    assert.match(html, /https:\/\/laawol\.test\/set\?oob=abc/);
    assert.match(html, /Set my password/);
  });

  it("escapes a business name that carries markup", () => {
    const html = renderAccessInvitationEmail(
        copyFor("en", {businessName: "Sow & <script>alert(1)</script>"}),
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&amp;/);
  });

  it("carries a plain-text twin with the same link", () => {
    const text = renderAccessInvitationText(copyFor("en"));
    assert.match(text, /Abdoullaye Sow/);
    assert.match(text, /https:\/\/laawol\.test\/set\?oob=abc/);
    assert.match(text, /expires/);
    assert.doesNotMatch(text, /</);
  });

  it("still renders when the action link could not be generated", () => {
    const html = renderAccessInvitationEmail(copyFor("en", {actionUrl: ""}));
    assert.doesNotMatch(html, /<a href=/);
    assert.match(html, /You are invited/);
  });
});
