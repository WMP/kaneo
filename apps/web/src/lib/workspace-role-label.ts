// Static keys keep the i18n checker able to see every string in use.
const DEFAULT_ROLE_LABEL_KEYS = {
  viewer: "team:roles.viewer",
  member: "team:roles.member",
  admin: "team:roles.admin",
  owner: "team:roles.owner",
} as const;

// Uppercases the first letter of every word, like the CSS `capitalize` the
// badges used before. Spaces and hyphens both start a new word.
function capitalizeWords(value: string): string {
  return value.replace(
    /(^|[\s-])(\p{L})/gu,
    (_, boundary: string, letter: string) =>
      `${boundary}${letter.toUpperCase()}`,
  );
}

/**
 * Display name for a workspace role: translated for the built-in roles, the
 * capitalized raw name (each word) for custom roles (which have no translation).
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
  return capitalizeWords(role);
}
