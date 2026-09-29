import { readCode } from "@/lib/workspace-role-error";

// Errors of the resource routes answer JSON `{ code, message }` (like the
// project member routes); the resource fetchers throw them through
// `readProjectApiError`, which keeps the `code`. The codes a person can act on
// map to translated copy; anything else falls back to a generic key. Static
// keys keep the i18n checker able to see every string in use.
const ERROR_KEYS_BY_CODE = {
  ROLE_EXCEEDS_YOUR_PERMISSIONS:
    "settings:workspaceResources.errors.roleExceedsYourPermissions",
  INSUFFICIENT_PERMISSIONS:
    "settings:workspaceResources.errors.insufficientPermissions",
  INSUFFICIENT_API_KEY_SCOPE:
    "settings:workspaceResources.errors.insufficientPermissions",
  PROJECT_ACCESS_DENIED:
    "settings:workspaceResources.errors.projectAccessDenied",
  ALREADY_WORKSPACE_MEMBER:
    "settings:workspaceResources.errors.alreadyWorkspaceMember",
  INVITATION_ROLE_CONFLICT:
    "settings:workspaceResources.errors.invitationRoleConflict",
  INVITATION_LIMIT_REACHED:
    "settings:workspaceResources.errors.invitationLimitReached",
  GUEST_CANNOT_INVITE: "settings:workspaceResources.errors.guestCannotInvite",
  DISPOSABLE_EMAIL_NOT_ALLOWED:
    "settings:workspaceResources.errors.disposableEmail",
  RATE_LIMITED: "settings:workspaceResources.errors.rateLimited",
  OWNER_ROLE_NOT_ALLOWED: "settings:workspaceResources.errors.ownerRole",
  UNKNOWN_ROLE: "settings:workspaceResources.errors.unknownRole",
  RESOURCE_NOT_PERSON: "settings:workspaceResources.errors.notPerson",
  RESOURCE_HAS_NO_EMAIL: "settings:workspaceResources.errors.noEmail",
  RESOURCE_ALREADY_LINKED: "settings:workspaceResources.errors.alreadyLinked",
  RESOURCE_NOT_LINKED: "settings:workspaceResources.errors.notLinked",
  NOT_A_WORKSPACE_MEMBER: "settings:workspaceResources.errors.notMember",
  RESOURCE_CHANGED: "settings:workspaceResources.errors.resourceChanged",
  DUPLICATE_PROJECT: "settings:workspaceResources.errors.duplicateProject",
  RESOURCE_EMAIL_NOT_ALLOWED:
    "settings:workspaceResources.errors.emailNotAllowed",
  RESOURCE_NAME_REQUIRED: "settings:workspaceResources.nameRequired",
  RESOURCE_NOT_FOUND: "settings:workspaceResources.errors.notFound",
  WORKSPACE_NOT_FOUND: "settings:workspaceResources.errors.notFound",
} as const;

/** The `code` of a failed resource request, when the API sent one. */
export function getResourceErrorCode(error: unknown): string | undefined {
  return readCode(error);
}

/**
 * The text to show for a failed resource request: translated for a known code,
 * else `fallbackKey`. The API's own English message is never shown.
 */
export function getResourceErrorMessage(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  const code = readCode(error);
  if (code && Object.hasOwn(ERROR_KEYS_BY_CODE, code)) {
    return t(ERROR_KEYS_BY_CODE[code as keyof typeof ERROR_KEYS_BY_CODE]);
  }
  return t(fallbackKey);
}
