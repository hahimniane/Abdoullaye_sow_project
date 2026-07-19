export type BusinessTab =
  | "today"
  | "profile"
  | "listings"
  | "purchases"
  | "barrels"
  | "freight"
  | "transport"
  | "parking"
  | "destinations"
  | "people"
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
  permission?: string;
};

export type BusinessSidebarGroup = {
  id: BusinessSidebarGroupId | "pinned";
  label: string;
  tabs: BusinessSidebarTab[];
};

export const businessSidebarTabs: BusinessSidebarTab[] = [
  {id: "today", label: "Today", description: "Needs attention", group: "overview"},
  {id: "profile", label: "Business", description: "Profile and services", group: "business", permission: "profile"},
  {id: "people", label: "People", description: "Owners and staff", group: "business", permission: "people"},
  {id: "listings", label: "Listings", description: "Vehicles for sale", group: "sales", service: "carSales", permission: "listings"},
  {id: "purchases", label: "Purchases", description: "Holds and buyers", group: "sales", service: "carSales", permission: "purchases"},
  {id: "barrels", label: "Barrels", description: "Shipping queue", group: "transport", service: "barrelShipping", permission: "barrels"},
  {id: "freight", label: "Freight", description: "Parcel shipping queue", group: "transport", service: "freight", permission: "freight"},
  {id: "transport", label: "Transport", description: "Vehicle moves", group: "transport", service: "carTransport", permission: "transport"},
  {id: "destinations", label: "Destinations", description: "Routes and pricing", group: "transport", permission: "destinations"},
  {id: "parking", label: "Parking", description: "Stored cars", group: "transport", service: "carParking", permission: "parking"},
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
