/**
 * Every area of the admin console, and how access to it is decided.
 *
 * This exists because the same list used to be written out three times - the
 * tab union, the role editor's section list, and the super admin's tab list -
 * and adding a feature meant remembering all three. Forgetting the role
 * editor was the expensive one: the area shipped, but no role could ever be
 * granted it, and nothing said so. The role editor now reads this list, so a
 * new area appears there the moment it is declared here.
 *
 * `governance` is the deliberate part. Adding an area forces a decision about
 * who may reach it rather than letting it default to invisible.
 */
export type AdminAreaGovernance =
  /** Everyone signed in sees it. */
  | "always"
  /** Roles grant it per-area as none / view / manage. */
  | "role"
  /** A standalone capability, granted or not - no view/manage distinction. */
  | "capability"
  /** Super admin only; not offered to custom roles at all. */
  | "superAdmin";

export type AdminCapability =
  | "users"
  | "businesses"
  | "marketplace"
  | "operations"
  | "finance"
  | "support"
  | "website";

export type AdminArea = {
  /** Tab id. Also the key a role's grants are stored under, so it is stable. */
  id: string;
  label: string;
  governance: AdminAreaGovernance;
  /** The capability "manage" on this area confers. Required unless always/superAdmin. */
  cap?: AdminCapability;
};

/**
 * Order here is the order everywhere: the nav, and the role editor's rows.
 */
export const adminAreas: AdminArea[] = [
  {id: "today", label: "Today", governance: "always"},
  {id: "businesses", label: "Businesses", governance: "role", cap: "businesses"},
  {id: "people", label: "People & access", governance: "role", cap: "users"},
  {id: "marketplace", label: "Marketplace", governance: "role", cap: "marketplace"},
  {id: "operations", label: "Operations", governance: "role", cap: "operations"},
  {id: "finance", label: "Finance", governance: "role", cap: "finance"},
  {id: "support", label: "Reply to support requests", governance: "capability", cap: "support"},
  {id: "website", label: "Website", governance: "role", cap: "website"},
  {id: "tools", label: "Tools", governance: "superAdmin"},
  {id: "settings", label: "Settings", governance: "superAdmin"},
];

/** Every area id, in nav order. */
export const adminAreaIds = adminAreas.map((area) => area.id);

/** Areas a role grants as none / view / manage. */
export const roleEditableAreas = adminAreas.filter(
  (area) => area.governance === "role",
);

/** Areas granted as a plain on/off capability. */
export const roleCapabilityAreas = adminAreas.filter(
  (area) => area.governance === "capability",
);

/**
 * What a role editor should offer. Anything a role can be granted appears
 * here, so a new area is selectable as soon as it is declared above.
 */
export const roleGrantableAreas = adminAreas.filter(
  (area) => area.governance === "role" || area.governance === "capability",
);

/**
 * Areas no role can be granted, with the reason. Rendered so an operator can
 * see that the omission is deliberate rather than wonder where a section went.
 */
export const nonGrantableAreas = adminAreas.filter(
  (area) => area.governance === "always" || area.governance === "superAdmin",
);
