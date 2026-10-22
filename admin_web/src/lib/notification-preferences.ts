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
  /** Staff activity: "Cars parked by my team" (someone else of the business parked a car). */
  parkedCarAlerts: boolean;
  /** Staff activity: "Packages saved by my team" (someone else of the business saved a package). */
  packageAlerts: boolean;
  /**
   * Platform admins (super admin, operations manager): "Platform activity" -
   * cars parked, packages saved and shop sales in every business, grouped per
   * business every 10 minutes (functions platform_activity_alerts.js).
   */
  platformActivity: boolean;
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
    parkedCarAlerts: true,
    packageAlerts: true,
    platformActivity: true,
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

/**
 * Staff activity alerts (functions staff_activity_alerts.js): shown to the
 * people the server tells - owners, and staff who work parking (cars) or
 * containers / deliveries (packages). The business console decides.
 */
export const parkedCarNotificationPreferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "parkedCarAlerts",
    label: "Cars parked by my team",
    hint: "A notification when someone else of the business parks a car",
  },
];

export const packageNotificationPreferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "packageAlerts",
    label: "Packages saved by my team",
    hint: "A notification when someone else of the business saves a package",
  },
];

/**
 * Platform activity alerts (functions platform_activity_alerts.js): only
 * platform admins whose adminRole is superAdmin or operationsManager receive
 * them, so only they see the switch. The admin console decides.
 */
export const PLATFORM_ACTIVITY_ADMIN_ROLES: readonly string[] = [
  "superAdmin",
  "operationsManager",
];

export function receivesPlatformActivityAlerts(
  role: unknown,
  adminRole: unknown,
): boolean {
  return (
    role === "admin" &&
    typeof adminRole === "string" &&
    PLATFORM_ACTIVITY_ADMIN_ROLES.includes(adminRole.trim())
  );
}

export const platformActivityNotificationPreferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "platformActivity",
    label: "Platform activity",
    hint: "A push when a car is parked, a package saved or a shop sale is made in any business (grouped every 10 minutes)",
  },
];
