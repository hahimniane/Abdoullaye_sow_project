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
  | "deliveries"
  | "volume"
  | "invoices"
  | "inventory"
  | "destinations"
  | "people"
  | "reviews"
  | "cases"
  | "growth"
  | "shipping";

/**
 * The steps of the Shipping page, in the order a package moves: asked for,
 * dropped off, loaded, handed over - then the online orders and the month.
 * Each was its own sidebar tab before; they are one page now so a package's
 * whole trip is in one place.
 */
export type ShippingStep =
  | "requests"
  | "waiting"
  | "containers"
  | "deliveries"
  | "barrels"
  | "freight"
  | "volume";

export type BusinessSidebarGroupId =
  | "overview"
  | "cars"
  | "money"
  | "business";

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
  // Whoever manages containers may hand packages over too (the server lets
  // "containers" deliver), so the Deliveries tab is theirs as well.
  deliveries: ["containers"],
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
  // Every shipping step in one page (shippingSteps below): it shows when the
  // viewer can open at least one of them (visibleShippingSteps).
  {id: "shipping", label: "Shipping", description: "Requests, waiting list, containers, deliveries", group: "overview", services: shippingServiceIds},
  {id: "parking", label: "Parking", description: "Stored cars", group: "cars", service: "carParking", permission: "parking"},
  {id: "ledger", label: "Lot ledger", description: "Activity, expenses, reports", group: "cars", service: "carParking", permission: "ledger"},
  {id: "transport", label: "Transport jobs", description: "Vehicle moves", group: "cars", service: "carTransport", permission: "transport"},
  {id: "listings", label: "Listings", description: "Vehicles for sale", group: "cars", service: "carSales", permission: "listings"},
  {id: "purchases", label: "Purchases", description: "Holds and buyers", group: "cars", service: "carSales", permission: "purchases"},
  // A viewing is an appointment, not a sale: no money moves and nothing is
  // bought. It shares the purchases permission because it is the same record
  // and the same staff work it, but it gets its own queue so "someone wants to
  // see a car" is not buried among holds and deposits.
  {id: "viewings", label: "Viewings", description: "Appointment requests", group: "cars", service: "carSales", permission: "purchases"},
  // Invoices are written by hand for anything the business sold, on the
  // platform or off it, so no service gate. Its own "invoices" permission;
  // "ledger" implies it (businessPermissionImplies), so the people who work
  // the lot's money keep this tab.
  {id: "invoices", label: "Invoices", description: "Receipts and what is owed", group: "money", permission: "invoices"},
  // Inventory is the shop's own goods, sold at the counter in the app and
  // recorded here. Its own service (admin switches it on per business, no
  // charge) and its own permission. It sits with Invoices - both are what the
  // business sold.
  {id: "inventory", label: "Inventory", description: "Products, stock and counter sales", group: "money", service: "inventory", permission: "inventory"},
  {id: "profile", label: "Profile", description: "Identity and verification", group: "business", permission: "profile"},
  {id: "destinations", label: "Services & coverage", description: "Availability, pickup, rates, and routes", group: "business", permission: "destinations"},
  {id: "people", label: "People", description: "Owners and staff", group: "business", permission: "people"},
  {id: "reviews", label: "Reviews", description: "Ratings and customer feedback", group: "business", permission: "reviews"},
  {id: "cases", label: "Support", description: "Customers and help", group: "business", permission: "support"},
  {id: "growth", label: "Growth", description: "Plan and advisor", group: "business", permission: "growth"},
];

export type ShippingStepSpec = {
  id: ShippingStep;
  label: string;
  /** Part of the package's trip (shown with arrows between), or an extra list. */
  flow: boolean;
  service?: string;
  services?: string[];
  permission: string;
};

/**
 * The Shipping page's steps. Requests, Waiting and Containers are the lists
 * of one loading-list workspace (the "containers" permission, as before);
 * Deliveries keeps its own permission, which "containers" implies.
 */
export const shippingSteps: ShippingStepSpec[] = [
  {id: "requests", label: "Requests", flow: true, services: shippingServiceIds, permission: "containers"},
  {id: "waiting", label: "Waiting", flow: true, services: shippingServiceIds, permission: "containers"},
  {id: "containers", label: "Containers", flow: true, services: shippingServiceIds, permission: "containers"},
  {id: "deliveries", label: "Deliveries", flow: true, services: shippingServiceIds, permission: "deliveries"},
  {id: "barrels", label: "Barrel orders", flow: false, service: "barrelShipping", permission: "barrels"},
  {id: "freight", label: "Freight", flow: false, service: "freight", permission: "freight"},
  {id: "volume", label: "This month", flow: false, services: shippingServiceIds, permission: "containers"},
];

/** The Shipping steps this viewer may open: the business offers it and the person holds its permission. */
export function visibleShippingSteps(
  offers: (serviceId: string) => boolean,
  holds: (permission: string) => boolean,
): ShippingStepSpec[] {
  return shippingSteps.filter((step) =>
    businessTabServiceAllowed(step, offers) && holds(step.permission),
  );
}

/**
 * The sidebar sections this viewer sees. Shipping shows when at least one
 * of its steps does; a business that stopped offering car sales keeps
 * Listings while it still has listings (`hasListings`).
 */
export function visibleBusinessTabs(
  offers: (serviceId: string) => boolean,
  holds: (permission: string) => boolean,
  {hasListings = false}: {hasListings?: boolean} = {},
): BusinessSidebarTab[] {
  const shippingOpen = visibleShippingSteps(offers, holds).length > 0;
  return businessSidebarTabs.filter((tab) => {
    if (tab.id === "shipping") return shippingOpen;
    const serviceAllowed =
      businessTabServiceAllowed(tab, offers) ||
      (tab.id === "listings" && hasListings);
    return serviceAllowed && (!tab.permission || holds(tab.permission));
  });
}

/** The steps that are lists of the loading-list workspace (one ContainersPanel). */
export const containerListSteps: readonly ShippingStep[] = ["requests", "waiting", "containers"];

/**
 * Where an old tab id lands now. Notifications, Today's rows and the
 * tracking page's deep link still name "containers", "barrels" and the
 * rest; each opens the matching Shipping step. `view` is the list a
 * notification or Today row asks for ("requests", "waiting").
 */
export function shippingStepForTab(tab: string, view = ""): ShippingStep | null {
  switch (tab) {
    case "containers":
      return view === "requests" || view === "waiting" ? view : "containers";
    case "deliveries":
    case "barrels":
    case "freight":
    case "volume":
      return tab;
    default:
      return null;
  }
}

const groupLabels: Record<BusinessSidebarGroupId, string> = {
  overview: "Overview",
  cars: "Cars",
  money: "Money",
  business: "Business",
};

const groupOrder: BusinessSidebarGroupId[] = [
  "overview",
  "cars",
  "money",
  "business",
];

export function normalizePinnedTabs(
  pinnedTabs: readonly string[],
  availableTabs: readonly BusinessSidebarTab[],
) {
  const available = new Set(availableTabs.map((tab) => tab.id));
  // A pin saved on an old shipping tab (Containers, Barrels...) is a pin on
  // Shipping now; several of them are one pin.
  const mapped = pinnedTabs.map((id) => (shippingStepForTab(id) ? "shipping" : id));
  return mapped.filter((id, index): id is BusinessTab =>
    available.has(id as BusinessTab) && mapped.indexOf(id) === index,
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
