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
