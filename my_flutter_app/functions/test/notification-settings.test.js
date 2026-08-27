const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationDeliveryStatus,
  notificationHtml,
  notificationProviderDeliveryUpdate,
  notificationRetryPlan,
  notificationTestReadiness,
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
          businessActivity: true,
          reviewActivity: true,
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

  it("maps Firebase Trigger Email delivery success details", () => {
    const update = notificationProviderDeliveryUpdate({
      channel: "email",
      provider: "firebaseTriggerEmail",
      providerDoc: {
        delivery: {
          state: "SUCCESS",
          attempts: 2,
          info: {
            messageId: "smtp-message-1",
            accepted: ["owner@example.com"],
            rejected: [],
            pending: ["backup@example.com"],
            response: "250 Message accepted",
          },
        },
      },
    });

    assert.deepEqual(update, {
      status: "sent",
      providerStatus: "SUCCESS",
      providerAttempts: 2,
      providerMessageId: "smtp-message-1",
      providerAccepted: ["owner@example.com"],
      providerRejected: [],
      providerPending: ["backup@example.com"],
      providerResponse: "250 Message accepted",
      providerStartedAt: null,
      providerEndedAt: null,
      lastError: "",
    });
  });

  it("maps Firebase Trigger Email processing and errors", () => {
    assert.equal(
        notificationProviderDeliveryUpdate({
          channel: "email",
          provider: "firebaseTriggerEmail",
          providerDoc: {delivery: {state: "PROCESSING"}},
        }).status,
        "processing",
    );

    const update = notificationProviderDeliveryUpdate({
      channel: "email",
      provider: "firebaseTriggerEmail",
      providerDoc: {
        delivery: {
          state: "ERROR",
          error: "SMTP authentication failed",
        },
      },
    });

    assert.equal(update.status, "failed");
    assert.equal(update.providerStatus, "ERROR");
    assert.equal(update.lastError, "SMTP authentication failed");
  });

  it("maps generic Firestore SMS worker delivery states", () => {
    assert.deepEqual(
        notificationProviderDeliveryUpdate({
          channel: "sms",
          provider: "firestoreSmsQueue",
          providerDoc: {
            status: "delivered",
            sid: "sms-1",
            response: "delivered",
          },
        }),
        {
          status: "sent",
          providerStatus: "delivered",
          providerMessageId: "sms-1",
          providerResponse: "delivered",
          providerStartedAt: null,
          providerEndedAt: null,
          lastError: "",
        },
    );

    const failed = notificationProviderDeliveryUpdate({
      channel: "sms",
      provider: "firestoreSmsQueue",
      providerDoc: {
        delivery: {
          state: "error",
          error: "Carrier rejected the message",
        },
      },
    });

    assert.equal(failed.status, "failed");
    assert.equal(failed.lastError, "Carrier rejected the message");
  });

  it("ignores provider records without a known delivery state", () => {
    assert.equal(
        notificationProviderDeliveryUpdate({
          channel: "email",
          provider: "firebaseTriggerEmail",
          providerDoc: {delivery: {state: "BOUNCED"}},
        }),
        null,
    );
    assert.equal(
        notificationProviderDeliveryUpdate({
          channel: "sms",
          provider: "firestoreSmsQueue",
          providerDoc: {status: "unknown"},
        }),
        null,
    );
  });

  it("builds Firebase Trigger Email retry payloads", () => {
    const plan = notificationRetryPlan({
      deliveryId: "delivery_1",
      settings: {
        emailEnabled: true,
        emailProvider: "firebaseTriggerEmail",
      },
      delivery: {
        channel: "email",
        to: "OWNER@EXAMPLE.COM",
        title: "Review approved",
        body: "Your business can now accept customers.",
        recipientUid: "owner_1",
      },
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.providerCollection, "mail");
    assert.deepEqual(plan.deliveryUpdate, {
      status: "queued",
      provider: "firebaseTriggerEmail",
      lastError: "",
    });
    assert.deepEqual(plan.providerDoc.to, ["owner@example.com"]);
    assert.equal(plan.providerDoc.message.subject, "Review approved");
    assert.equal(
        plan.providerDoc.message.html,
        "<p>Your business can now accept customers.</p>" +
          "<hr><p><small>Review approved</small></p>",
    );
    assert.deepEqual(plan.existingProviderUpdate, {
      delivery: {state: "RETRY"},
    });
  });

  it("builds Firestore SMS retry payloads", () => {
    const plan = notificationRetryPlan({
      deliveryId: "delivery_2",
      settings: {
        smsEnabled: true,
        smsProvider: "firestoreSmsQueue",
      },
      delivery: {
        channel: "sms",
        to: "+17185550199",
        title: "Shipment update",
        body: "Your shipment is ready.",
        recipientUid: "customer_1",
      },
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.providerCollection, "smsMessages");
    assert.deepEqual(plan.deliveryUpdate, {
      status: "queued",
      provider: "firestoreSmsQueue",
      lastError: "",
    });
    assert.deepEqual(plan.providerDoc, {
      to: "+17185550199",
      body: "Your shipment is ready.",
      deliveryId: "delivery_2",
      recipientUid: "customer_1",
    });
    assert.deepEqual(plan.existingProviderUpdate, {status: "queued"});
  });

  it("blocks retry until the matching sender provider is connected", () => {
    assert.deepEqual(
        notificationRetryPlan({
          deliveryId: "delivery_3",
          settings: {emailProvider: "none"},
          delivery: {
            channel: "email",
            to: "owner@example.com",
          },
        }),
        {
          ok: false,
          code: "email_provider_unavailable",
          message: "Connect the Firebase Trigger Email provider " +
            "before retrying.",
        },
    );
    assert.deepEqual(
        notificationRetryPlan({
          deliveryId: "delivery_4",
          settings: {smsEnabled: false, smsProvider: "firestoreSmsQueue"},
          delivery: {
            channel: "sms",
            to: "+17185550199",
          },
        }),
        {
          ok: false,
          code: "sms_provider_unavailable",
          message: "Connect the Firestore SMS queue provider before retrying.",
        },
    );
  });

  it("blocks notification tests until their provider is connected", () => {
    assert.deepEqual(
        notificationTestReadiness({
          channel: "email",
          settings: {emailProvider: "none"},
        }),
        {
          ok: false,
          code: "email_provider_unavailable",
          message: "Connect the Firebase Trigger Email provider " +
            "before testing.",
        },
    );
    assert.deepEqual(
        notificationTestReadiness({
          channel: "sms",
          settings: {smsEnabled: true, smsProvider: "firestoreSmsQueue"},
        }),
        {
          ok: true,
          channel: "sms",
          provider: "firestoreSmsQueue",
        },
    );
    assert.deepEqual(
        notificationTestReadiness({
          channel: "push",
          settings: {},
        }),
        {
          ok: false,
          code: "unsupported_channel",
          message: "Choose email or SMS for the notification test.",
        },
    );
  });
});
