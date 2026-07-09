const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationHtml,
  platformNotificationEnabled,
} = require("../notification_settings");

describe("notification settings helpers", () => {
  it("normalizes user notification channels and categories", () => {
    assert.deepEqual(
        normalizeNotificationPreferences({
          pushNotifications: false,
          emailNotifications: true,
          smsNotifications: true,
          supportActivity: false,
        }),
        {
          pushNotifications: false,
          emailNotifications: true,
          smsNotifications: true,
          carActivity: true,
          shipmentActivity: true,
          walletActivity: true,
          businessActivity: true,
          supportActivity: false,
          supportMessages: false,
          supportEscalations: false,
          supportCaseUpdates: false,
        },
    );
  });

  it("keeps SMS disabled until the platform explicitly enables it", () => {
    const defaults = normalizePlatformNotificationSettings({});
    assert.equal(defaults.pushEnabled, true);
    assert.equal(defaults.emailEnabled, true);
    assert.equal(defaults.smsEnabled, false);

    const enabled = normalizePlatformNotificationSettings({
      smsEnabled: true,
      verificationDocuments: false,
    });
    assert.equal(enabled.smsEnabled, true);
    assert.equal(enabled.verificationDocuments, false);
    assert.equal(
        platformNotificationEnabled(
            enabled,
            "businessActivity",
            "verificationDocuments",
        ),
        false,
    );
  });

  it("stringifies notification data and escapes email html", () => {
    assert.deepEqual(
        notificationData({count: 2, missing: null, ok: true}),
        {count: "2", missing: "", ok: "true"},
    );
    assert.equal(
        notificationHtml("Review <now>", "A & B"),
        "<p>A &amp; B</p><hr><p><small>Review &lt;now&gt;</small></p>",
    );
  });
});
