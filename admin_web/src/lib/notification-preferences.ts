// Mirrors defaultNotificationPreferences() / normalizeNotificationPreferences()
// in functions/notification_settings.js, and the toggle set exposed on the
// mobile app's account profile screen - keep both in sync when changing.
export type NotificationPreferences = {
  pushNotifications: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  carActivity: boolean;
  shipmentActivity: boolean;
  walletActivity: boolean;
  businessActivity: boolean;
};

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    pushNotifications: true,
    emailNotifications: true,
    smsNotifications: false,
    carActivity: true,
    shipmentActivity: true,
    walletActivity: true,
    businessActivity: true,
  };
}

export function mergeNotificationPreferences(
  saved?: Record<string, boolean>,
): NotificationPreferences {
  return { ...defaultNotificationPreferences(), ...(saved ?? {}) };
}

export const notificationPreferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "pushNotifications",
    label: "Push notifications",
    hint: "Alerts sent to your phone or browser",
  },
  {
    key: "emailNotifications",
    label: "Email notifications",
    hint: "Updates sent to your email address",
  },
  {
    key: "smsNotifications",
    label: "SMS notifications",
    hint: "Text messages for account activity",
  },
  {
    key: "carActivity",
    label: "Car purchase and reservation updates",
    hint: "Purchases, parking, and reservation status",
  },
  {
    key: "shipmentActivity",
    label: "Shipment updates",
    hint: "Barrel and freight shipment status",
  },
  {
    key: "businessActivity",
    label: "Business updates",
    hint: "Application, verification, and account status",
  },
];
