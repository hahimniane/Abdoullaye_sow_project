const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationDeliveryStatus,
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
    assert.equal(defaults.emailProvider, "none");
    assert.equal(defaults.smsProvider, "none");

    const enabled = normalizePlatformNotificationSettings({
      smsEnabled: true,
      emailProvider: "firebaseTriggerEmail",
      smsProvider: "firestoreSmsQueue",
      verificationDocuments: false,
    });
    assert.equal(enabled.smsEnabled, true);
    assert.equal(enabled.emailProvider, "firebaseTriggerEmail");
    assert.equal(enabled.smsProvider, "firestoreSmsQueue");
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

  it("marks channel deliveries as pending provider configuration", () => {
    const settings = normalizePlatformNotificationSettings({
      smsEnabled: true,
    });
    const prefs = normalizeNotificationPreferences({
      smsNotifications: true,
    });
    assert.equal(
        notificationDeliveryStatus({
          settings,
          prefs,
          channel: "email",
          recipientAvailable: true,
        }),
        "provider_not_configured",
    );
    assert.equal(
        notificationDeliveryStatus({
          settings,
          prefs,
          channel: "sms",
          recipientAvailable: true,
        }),
        "provider_not_configured",
    );
  });

  it("queues channel deliveries only when a provider is selected", () => {
    const settings = normalizePlatformNotificationSettings({
      smsEnabled: true,
      emailProvider: "firebaseTriggerEmail",
      smsProvider: "firestoreSmsQueue",
    });
    const prefs = normalizeNotificationPreferences({
      smsNotifications: true,
    });
    assert.equal(
        notificationDeliveryStatus({
          settings,
          prefs,
          channel: "email",
          recipientAvailable: true,
        }),
        "queued",
    );
    assert.equal(
        notificationDeliveryStatus({
          settings,
          prefs,
          channel: "sms",
          recipientAvailable: true,
        }),
        "queued",
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
