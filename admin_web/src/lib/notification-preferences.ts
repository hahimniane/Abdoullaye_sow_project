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
  /** Inventory: "Sales at my store" (push when someone else rings up a sale). */
  inventorySales: boolean;
  /** Inventory: "Credit I collect" (push when a credit is put on me, and when it is overdue). */
  inventoryCredit: boolean;
  /** Inventory: "Store transfers" (sent to my store, cancelled, didn't arrive, reminders). */
  inventoryTransfers: boolean;
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
    inventorySales: true,
    inventoryCredit: true,
    inventoryTransfers: true,
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

/** Shown only to people who use Inventory (the business console decides). */
export const inventoryNotificationPreferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "inventorySales",
    label: "Sales at my store",
    hint: "A notification when someone else rings up a sale",
  },
  {
    key: "inventoryCredit",
    label: "Credit I collect",
    hint: "When a sale on credit is given to you to collect, and when it is overdue",
  },
  {
    key: "inventoryTransfers",
    label: "Store transfers",
    hint: "When stock is sent to your store, and when items of a transfer didn't arrive",
  },
];
