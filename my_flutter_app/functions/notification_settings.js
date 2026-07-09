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

function normalizePlatformNotificationSettings(raw) {
  const defaults = defaultPlatformNotificationSettings();
  const settings = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [
        key,
        value === false ? settings[key] === true : settings[key] !== false,
      ]),
  );
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

module.exports = {
  defaultNotificationPreferences,
  defaultPlatformNotificationSettings,
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationHtml,
  platformNotificationEnabled,
};
