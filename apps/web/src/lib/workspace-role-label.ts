// Static keys keep the i18n checker able to see every string in use.
const DEFAULT_ROLE_LABEL_KEYS = {
  viewer: "team:roles.viewer",
  member: "team:roles.member",
  admin: "team:roles.admin",
  owner: "team:roles.owner",
} as const;

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Display name for a workspace role: translated for the built-in roles, the
 * capitalized raw name for custom roles (which have no translation).
 */
export function getWorkspaceRoleLabel(
  role: string,
  t: (key: string) => string,
): string {
  if (Object.hasOwn(DEFAULT_ROLE_LABEL_KEYS, role)) {
    return t(
      DEFAULT_ROLE_LABEL_KEYS[role as keyof typeof DEFAULT_ROLE_LABEL_KEYS],
    );
  }
  return capitalize(role);
}
