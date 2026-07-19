function defaultNotificationPreferences() {
  return {
    pushNotifications: true,
    emailNotifications: true,
    smsNotifications: false,
    carActivity: true,
    shipmentActivity: true,
    walletActivity: true,
    businessActivity: true,
    supportActivity: true,
    supportMessages: true,
    supportEscalations: true,
    supportCaseUpdates: true,
  };
}

function normalizeNotificationPreferences(raw) {
  const defaults = defaultNotificationPreferences();
  const prefs = raw && typeof raw === "object" ? raw : {};
  return {
    pushNotifications:
      prefs.pushNotifications !== false && defaults.pushNotifications,
    emailNotifications:
      prefs.emailNotifications !== false && defaults.emailNotifications,
    smsNotifications: prefs.smsNotifications === true,
    carActivity: prefs.carActivity !== false && defaults.carActivity,
    shipmentActivity:
      prefs.shipmentActivity !== false && defaults.shipmentActivity,
    walletActivity: prefs.walletActivity !== false && defaults.walletActivity,
    businessActivity:
      prefs.businessActivity !== false && defaults.businessActivity,
    supportActivity:
      prefs.supportActivity !== false && defaults.supportActivity,
    supportMessages:
      prefs.supportMessages !== false && prefs.supportActivity !== false &&
        defaults.supportMessages,
    supportEscalations:
      prefs.supportEscalations !== false && prefs.supportActivity !== false &&
        defaults.supportEscalations,
    supportCaseUpdates:
      prefs.supportCaseUpdates !== false && prefs.supportActivity !== false &&
        defaults.supportCaseUpdates,
  };
}

function defaultPlatformNotificationSettings() {
  return {
    pushEnabled: true,
    emailEnabled: true,
    smsEnabled: false,
    emailProvider: "none",
    smsProvider: "none",
    purchaseStatus: true,
    shipmentStatus: true,
    refundDecision: true,
    newApplication: true,
    businessLifecycle: true,
    verificationDocuments: true,
    supportMessages: true,
    supportEscalations: true,
    supportCaseUpdates: true,
    notifyAdmins: true,
  };
}

function normalizeProvider(value, allowed, fallback = "none") {
  const clean = String(value || "").trim();
  return allowed.has(clean) ? clean : fallback;
}

function normalizePlatformNotificationSettings(raw) {
  const defaults = defaultPlatformNotificationSettings();
  const settings = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (key === "emailProvider") {
      normalized[key] = normalizeProvider(
          settings[key],
          new Set(["none", "firebaseTriggerEmail"]),
      );
    } else if (key === "smsProvider") {
      normalized[key] = normalizeProvider(
          settings[key],
          new Set(["none", "firestoreSmsQueue"]),
      );
    } else {
      normalized[key] =
        value === false ? settings[key] === true : settings[key] !== false;
    }
  }
  return normalized;
}

const NOTIFICATION_SETTING_BY_PREFERENCE = {
  carActivity: "purchaseStatus",
  shipmentActivity: "shipmentStatus",
  walletActivity: "refundDecision",
  businessActivity: "businessLifecycle",
  supportActivity: "supportMessages",
  supportMessages: "supportMessages",
  supportEscalations: "supportEscalations",
  supportCaseUpdates: "supportCaseUpdates",
};

function platformNotificationEnabled(settings, preferenceKey, settingKey = "") {
  const key = settingKey || NOTIFICATION_SETTING_BY_PREFERENCE[preferenceKey];
  return !key || settings[key] !== false;
}

function notificationDeliveryStatus({
  settings,
  prefs,
  channel,
  recipientAvailable,
}) {
  if (channel === "email") {
    if (settings.emailEnabled === false) return "disabled";
    if (prefs.emailNotifications === false) return "opted_out";
    if (!recipientAvailable) return "no_recipient";
    return settings.emailProvider === "firebaseTriggerEmail" ?
      "queued" :
      "provider_not_configured";
  }
  if (channel === "sms") {
    if (settings.smsEnabled === false) return "disabled";
    if (prefs.smsNotifications !== true) return "opted_out";
    if (!recipientAvailable) return "no_recipient";
    return settings.smsProvider === "firestoreSmsQueue" ?
      "queued" :
      "provider_not_configured";
  }
  return "disabled";
}

function notificationData(data) {
  return Object.fromEntries(
      Object.entries(data || {}).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
  );
}

function notificationHtml(title, body) {
  const escape = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return [
    `<p>${escape(body)}</p>`,
    "<hr>",
    `<p><small>${escape(title)}</small></p>`,
  ].join("");
}

function cleanString(value) {
  return String(value || "").trim();
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item)).filter(Boolean);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const FIREBASE_TRIGGER_EMAIL_STATUS = {
  PENDING: "queued",
  RETRY: "queued",
  PROCESSING: "processing",
  SUCCESS: "sent",
  ERROR: "failed",
};

const FIRESTORE_SMS_STATUS = {
  pending: "queued",
  queued: "queued",
  retry: "queued",
  processing: "processing",
  sending: "processing",
  sent: "sent",
  success: "sent",
  delivered: "sent",
  failed: "failed",
  error: "failed",
  undelivered: "failed",
};

function withDefinedValues(value) {
  return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function firebaseTriggerEmailDeliveryUpdate(providerDoc) {
  const source = providerDoc && typeof providerDoc === "object" ?
    providerDoc :
    {};
  const delivery = source.delivery && typeof source.delivery === "object" ?
    source.delivery :
    {};
  const rawState = cleanString(delivery.state).toUpperCase();
  const status = FIREBASE_TRIGGER_EMAIL_STATUS[rawState];
  if (!status) return null;

  const info = delivery.info && typeof delivery.info === "object" ?
    delivery.info :
    {};
  const attempts = cleanNumber(delivery.attempts);
  return withDefinedValues({
    status,
    providerStatus: rawState,
    providerAttempts: attempts === null ? undefined : attempts,
    providerMessageId: cleanString(info.messageId),
    providerAccepted: cleanStringArray(info.accepted),
    providerRejected: cleanStringArray(info.rejected),
    providerPending: cleanStringArray(info.pending),
    providerResponse: cleanString(info.response),
    providerStartedAt: delivery.startTime || null,
    providerEndedAt: delivery.endTime || null,
    lastError: status === "failed" ?
      cleanString(delivery.error) || "Email delivery failed." :
      "",
  });
}

function firestoreSmsDeliveryUpdate(providerDoc) {
  const source = providerDoc && typeof providerDoc === "object" ?
    providerDoc :
    {};
  const delivery = source.delivery && typeof source.delivery === "object" ?
    source.delivery :
    {};
  const rawStatus = cleanString(
      source.status || delivery.status || delivery.state,
  ).toLowerCase();
  const status = FIRESTORE_SMS_STATUS[rawStatus];
  if (!status) return null;

  const providerMessageId = cleanString(
      source.messageId || delivery.messageId || source.sid || delivery.sid,
  );
  const providerResponse = cleanString(source.response || delivery.response);
  const providerError = cleanString(
      source.lastError || delivery.lastError || source.error || delivery.error,
  );
  return withDefinedValues({
    status,
    providerStatus: rawStatus,
    providerMessageId,
    providerResponse,
    providerStartedAt: delivery.startTime || source.startedAt || null,
    providerEndedAt: delivery.endTime || source.completedAt || null,
    lastError: status === "failed" ?
      providerError || "SMS delivery failed." :
      "",
  });
}

function notificationProviderDeliveryUpdate({channel, provider, providerDoc}) {
  if (channel === "email" && provider === "firebaseTriggerEmail") {
    return firebaseTriggerEmailDeliveryUpdate(providerDoc);
  }
  if (channel === "sms" && provider === "firestoreSmsQueue") {
    return firestoreSmsDeliveryUpdate(providerDoc);
  }
  return null;
}

function retryFailure(code, message) {
  return {ok: false, code, message};
}

function notificationTestReadiness({channel, settings}) {
  const config = normalizePlatformNotificationSettings(settings);
  const cleanChannel = cleanString(channel).toLowerCase();
  if (cleanChannel === "email") {
    if (config.emailEnabled === false ||
      config.emailProvider !== "firebaseTriggerEmail") {
      return retryFailure(
          "email_provider_unavailable",
          "Connect the Firebase Trigger Email provider before testing.",
      );
    }
    return {
      ok: true,
      channel: "email",
      provider: "firebaseTriggerEmail",
    };
  }
  if (cleanChannel === "sms") {
    if (config.smsEnabled === false ||
      config.smsProvider !== "firestoreSmsQueue") {
      return retryFailure(
          "sms_provider_unavailable",
          "Connect the Firestore SMS queue provider before testing.",
      );
    }
    return {
      ok: true,
      channel: "sms",
      provider: "firestoreSmsQueue",
    };
  }
  return retryFailure(
      "unsupported_channel",
      "Choose email or SMS for the notification test.",
  );
}

function notificationRetryPlan({deliveryId, delivery, settings}) {
  const source = delivery && typeof delivery === "object" ? delivery : {};
  const config = normalizePlatformNotificationSettings(settings);
  const channel = cleanString(source.channel).toLowerCase();
  const recipientUid = cleanString(source.recipientUid);
  const title = cleanString(source.title) || "Laawol Digital update";
  const body = cleanString(source.body);
  const id = cleanString(deliveryId);
  if (!id) {
    return retryFailure(
        "missing_delivery_id",
        "Delivery ID is required.",
    );
  }

  if (channel === "email") {
    const email = cleanString(source.to).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return retryFailure(
          "missing_email_recipient",
          "This delivery does not have a valid email recipient.",
      );
    }
    if (config.emailEnabled === false ||
      config.emailProvider !== "firebaseTriggerEmail") {
      return retryFailure(
          "email_provider_unavailable",
          "Connect the Firebase Trigger Email provider before retrying.",
      );
    }
    return {
      ok: true,
      channel,
      provider: "firebaseTriggerEmail",
      providerCollection: "mail",
      deliveryUpdate: {
        status: "queued",
        provider: "firebaseTriggerEmail",
        lastError: "",
      },
      providerDoc: {
        to: [email],
        message: {
          subject: title,
          text: body,
          html: notificationHtml(title, body),
        },
        deliveryId: id,
        recipientUid,
      },
      existingProviderUpdate: {
        delivery: {state: "RETRY"},
      },
    };
  }

  if (channel === "sms") {
    const phone = cleanString(source.to);
    if (!phone) {
      return retryFailure(
          "missing_sms_recipient",
          "This delivery does not have a phone recipient.",
      );
    }
    if (config.smsEnabled === false ||
      config.smsProvider !== "firestoreSmsQueue") {
      return retryFailure(
          "sms_provider_unavailable",
          "Connect the Firestore SMS queue provider before retrying.",
      );
    }
    return {
      ok: true,
      channel,
      provider: "firestoreSmsQueue",
      providerCollection: "smsMessages",
      deliveryUpdate: {
        status: "queued",
        provider: "firestoreSmsQueue",
        lastError: "",
      },
      providerDoc: {
        to: phone,
        body: body || title,
        deliveryId: id,
        recipientUid,
      },
      existingProviderUpdate: {
        status: "queued",
      },
    };
  }

  return retryFailure(
      "unsupported_channel",
      "Only email and SMS deliveries can be retried.",
  );
}

module.exports = {
  defaultNotificationPreferences,
  defaultPlatformNotificationSettings,
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationDeliveryStatus,
  notificationHtml,
  notificationProviderDeliveryUpdate,
  notificationRetryPlan,
  notificationTestReadiness,
  platformNotificationEnabled,
};
