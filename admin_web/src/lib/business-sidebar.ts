export type BusinessTab =
  | "today"
  | "profile"
  | "listings"
  | "purchases"
  | "viewings"
  | "barrels"
  | "freight"
  | "transport"
  | "parking"
  | "ledger"
  | "containers"
  | "invoices"
  | "inventory"
  | "destinations"
  | "people"
  | "reviews"
  | "cases"
  | "growth";

export type BusinessSidebarGroupId =
  | "overview"
  | "business"
  | "sales"
  | "transport"
  | "manage";

export type BusinessSidebarTab = {
  id: BusinessTab;
  label: string;
  description: string;
  group: BusinessSidebarGroupId;
  service?: string;
  /** Shown when the business offers ANY of these (use `service` for a single one). */
  services?: string[];
  permission?: string;
};

/**
 * The services that put goods on a container: a business that ships barrels,
 * parcels or vehicles, or stores cars for loading, has loading lists. A shop
 * that only sells at the counter has none, so it never sees the Containers tab
 * (or a Containers permission chip that does nothing).
 */
export const shippingServiceIds = ["barrelShipping", "freight", "carTransport", "carParking"];

/**
 * Permissions that also grant another one. Staff who could work the lot ledger
 * could always open Invoices (it used to be gated on "ledger"), so holding
 * "ledger" keeps that access now that Invoices has a permission of its own.
 */
export const businessPermissionImplies: Readonly<Record<string, readonly string[]>> = {
  invoices: ["ledger"],
};

/** Whether a team member's permission list grants `permission`, directly or through another. */
export function businessPermissionHeld(held: readonly string[], permission: string) {
  return (
    held.includes(permission) ||
    (businessPermissionImplies[permission] ?? []).some((other) => held.includes(other))
  );
}

/** Whether the business offers what the tab needs: nothing, one service, or any of several. */
export function businessTabServiceAllowed(
  tab: Pick<BusinessSidebarTab, "service" | "services">,
  offers: (serviceId: string) => boolean,
) {
  if (!tab.service && !tab.services) return true;
  return (
    (tab.service !== undefined && offers(tab.service)) ||
    (tab.services ?? []).some(offers)
  );
}

export type BusinessSidebarGroup = {
  id: BusinessSidebarGroupId | "pinned";
  label: string;
  tabs: BusinessSidebarTab[];
};

export const businessSidebarTabs: BusinessSidebarTab[] = [
  {id: "today", label: "Today", description: "Needs attention", group: "overview"},
  {id: "profile", label: "Business", description: "Identity and verification", group: "business", permission: "profile"},
  {id: "destinations", label: "Services & coverage", description: "Availability, pickup, rates, and routes", group: "business", permission: "destinations"},
  {id: "people", label: "People", description: "Owners and staff", group: "business", permission: "people"},
  {id: "listings", label: "Listings", description: "Vehicles for sale", group: "sales", service: "carSales", permission: "listings"},
  {id: "purchases", label: "Purchases", description: "Holds and buyers", group: "sales", service: "carSales", permission: "purchases"},
  // A viewing is an appointment, not a sale: no money moves and nothing is
  // bought. It shares the purchases permission because it is the same record
  // and the same staff work it, but it gets its own queue so "someone wants to
  // see a car" is not buried among holds and deposits.
  {id: "viewings", label: "Viewings", description: "Appointment requests", group: "sales", service: "carSales", permission: "purchases"},
  {id: "barrels", label: "Barrels", description: "Shipping queue", group: "transport", service: "barrelShipping", permission: "barrels"},
  {id: "freight", label: "Freight", description: "Parcel shipping queue", group: "transport", service: "freight", permission: "freight"},
  {id: "transport", label: "Transport", description: "Vehicle moves", group: "transport", service: "carTransport", permission: "transport"},
  {id: "parking", label: "Parking", description: "Stored cars", group: "transport", service: "carParking", permission: "parking"},
  {id: "ledger", label: "Lot ledger", description: "Activity, expenses, reports", group: "transport", service: "carParking", permission: "ledger"},
  // A container is the business's own loading list, independent of any
  // customer request - but only a business that ships or stores goods loads
  // one, so it shows when ANY shipping service is on (owners and staff
  // alike), plus the permission.
  {id: "containers", label: "Containers", description: "Loading lists and sailings", group: "transport", services: shippingServiceIds, permission: "containers"},
  // Invoices are written by hand for anything the business sold, on the
  // platform or off it, so no service gate. Its own "invoices" permission;
  // "ledger" implies it (businessPermissionImplies), so the people who work
  // the lot's money keep this tab.
  {id: "invoices", label: "Invoices", description: "Receipts and what is owed", group: "manage", permission: "invoices"},
  // Inventory is the shop's own goods, sold at the counter in the app and
  // recorded here. Its own service (admin switches it on per business, no
  // charge) and its own permission. It sits with Invoices - both are what the
  // business sold - rather than under "Vehicle sales", which it is not.
  {id: "inventory", label: "Inventory", description: "Products, stock and counter sales", group: "manage", service: "inventory", permission: "inventory"},
  {id: "reviews", label: "Reviews", description: "Ratings and customer feedback", group: "manage", permission: "reviews"},
  {id: "cases", label: "Support", description: "Customers and help", group: "manage", permission: "support"},
  {id: "growth", label: "Growth", description: "Plan and advisor", group: "manage", permission: "growth"},
];

const groupLabels: Record<BusinessSidebarGroupId, string> = {
  overview: "Overview",
  business: "Business setup",
  sales: "Vehicle sales",
  transport: "Transport & shipping",
  manage: "Manage",
};

const groupOrder: BusinessSidebarGroupId[] = [
  "overview",
  "business",
  "sales",
  "transport",
  "manage",
];

export function normalizePinnedTabs(
  pinnedTabs: readonly string[],
  availableTabs: readonly BusinessSidebarTab[],
) {
  const available = new Set(availableTabs.map((tab) => tab.id));
  return pinnedTabs.filter((id): id is BusinessTab =>
    available.has(id as BusinessTab),
  );
}

export function buildBusinessSidebarGroups(
  tabs: readonly BusinessSidebarTab[],
  pinnedTabs: readonly string[],
  filter: string,
): BusinessSidebarGroup[] {
  const needle = filter.trim().toLowerCase();
  const pinned = new Set(normalizePinnedTabs(pinnedTabs, tabs));
  const matchingTabs = needle
    ? tabs.filter((tab) =>
        [tab.label, tab.description, groupLabels[tab.group], tab.service]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
      )
    : [...tabs];
  const groups: BusinessSidebarGroup[] = [];
  const pinnedGroup = matchingTabs.filter((tab) => pinned.has(tab.id));

  if (pinnedGroup.length > 0) {
    groups.push({id: "pinned", label: "Pinned", tabs: pinnedGroup});
  }

  groupOrder.forEach((groupId) => {
    const groupTabs = matchingTabs.filter((tab) =>
      tab.group === groupId && !pinned.has(tab.id),
    );
    if (groupTabs.length > 0) {
      groups.push({id: groupId, label: groupLabels[groupId], tabs: groupTabs});
    }
  });

  return groups;
}
