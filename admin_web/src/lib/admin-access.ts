export function resolveAdminRoleKey(
  adminRole: unknown,
  previewMode: boolean,
): string {
  if (previewMode) return "superAdmin";
  return typeof adminRole === "string" ? adminRole.trim() : "";
}

export function resolveAssignableAdminRole(
  adminRole: unknown,
  roleKeys: readonly string[],
): string {
  const key = resolveAdminRoleKey(adminRole, false);
  return roleKeys.includes(key) ? key : "";
}

// ---------------------------------------------------------------------------
// Admin roles. Super admins create and edit roles in Settings; they are stored
// in Firestore (platformConfig/permissions) over these built-in defaults. Each
// role grants each console section an access level and may be limited to a
// set of platform services. Lives here, not in admin-console.tsx, so a page
// outside the admin console (the package tracking page) can ask what an
// admin may see without shipping the whole console.
// ---------------------------------------------------------------------------

export type AdminAccessLevel = "none" | "view" | "manage";

export type AdminRoleConfig = {
  label: string;
  builtIn?: boolean;
  sections: Record<string, AdminAccessLevel>;
  services: string[]; // empty = all services
};

export type AdminPermissionsConfig = { roles?: Record<string, AdminRoleConfig> };

export const DEFAULT_ADMIN_ROLES: Record<string, AdminRoleConfig> = {
  operationsManager: {
    label: "Operations manager",
    builtIn: true,
    services: [],
    sections: {
      people: "view",
      businesses: "manage",
      marketplace: "manage",
      operations: "manage",
      finance: "none",
      website: "manage",
      support: "manage",
    },
  },
  financeManager: {
    label: "Finance manager",
    builtIn: true,
    services: [],
    sections: {
      people: "view",
      businesses: "none",
      marketplace: "none",
      operations: "view",
      finance: "manage",
      website: "none",
      support: "manage",
    },
  },
  supportAdmin: {
    label: "Support admin",
    builtIn: true,
    services: [],
    sections: {
      people: "view",
      businesses: "view",
      marketplace: "view",
      operations: "view",
      finance: "none",
      website: "none",
      support: "manage",
    },
  },
  contentManager: {
    label: "Content manager",
    builtIn: true,
    services: [],
    sections: {
      people: "view",
      businesses: "view",
      marketplace: "none",
      operations: "none",
      finance: "none",
      website: "manage",
      support: "none",
    },
  },
};

function labelOr(value: unknown, fallback: string): string {
  return String(value ?? "").trim() || fallback;
}

/** Built-in defaults overlaid with any stored config (custom + edited roles). */
export function mergedAdminRoles(
  config: AdminPermissionsConfig | null,
): Record<string, AdminRoleConfig> {
  const roles: Record<string, AdminRoleConfig> = {};
  for (const [key, value] of Object.entries(DEFAULT_ADMIN_ROLES)) {
    roles[key] = {
      ...value,
      sections: { ...value.sections },
      services: [...value.services],
    };
  }
  for (const [key, value] of Object.entries(config?.roles ?? {})) {
    const base = roles[key];
    roles[key] = {
      label: labelOr(value.label, base?.label ?? key),
      builtIn: base?.builtIn ?? false,
      sections: { ...(base?.sections ?? {}), ...(value.sections ?? {}) },
      services: Array.isArray(value.services)
        ? value.services
        : (base?.services ?? []),
    };
  }
  return roles;
}

/**
 * What an admin role grants on one console section: everything for a super
 * admin, the merged role's level otherwise, "none" for a role that does not
 * exist (fails closed, like the admin console's resolvePerms).
 */
export function adminSectionAccess(
  adminRole: unknown,
  config: AdminPermissionsConfig | null,
  section: string,
): AdminAccessLevel {
  const key = resolveAdminRoleKey(adminRole, false);
  if (key === "superAdmin") return "manage";
  if (!key) return "none";
  const level = mergedAdminRoles(config)[key]?.sections[section];
  return level === "view" || level === "manage" ? level : "none";
}
