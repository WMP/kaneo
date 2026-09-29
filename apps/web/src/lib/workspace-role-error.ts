import { HttpError } from "@/lib/http-error";

// Better Auth client errors carry a machine-readable `code`. The invite and
// role-change flows map the ones users can act on to translated copy; anything
// else falls back to the API message and finally to a generic key.
const ERROR_KEYS_BY_CODE: Record<string, string> = {
  ROLE_EXCEEDS_YOUR_PERMISSIONS: "team:errors.roleExceedsYourPermissions",
  YOU_CANNOT_CHANGE_YOUR_OWN_ROLE: "team:errors.cannotChangeOwnRole",
  YOU_CANNOT_MANAGE_THIS_MEMBER: "team:errors.cannotManageMember",
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: "team:errors.cannotUpdateMember",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE:
    "team:errors.cannotInviteWithRole",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "team:errors.alreadyMember",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "team:errors.alreadyInvited",
  INVITATION_LIMIT_REACHED: "team:errors.invitationLimitReached",
  // Deleting or renaming a role that project members or pending project
  // invitations still use is refused until they are moved to another role.
  ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS:
    "projectMembers:errors.roleAssignedToProjectMembers",
};

type WorkspaceMemberErrorInit = {
  code?: string;
  status?: number;
};

/** Error thrown by member mutations. Keeps the API `code` for the UI. */
export class WorkspaceMemberError extends Error {
  code?: string;
  status?: number;

  constructor(
    message: string,
    { code, status }: WorkspaceMemberErrorInit = {},
  ) {
    super(message);
    this.name = "WorkspaceMemberError";
    this.code = code;
    this.status = status;
  }
}

type AuthClientErrorLike = {
  code?: string;
  message?: string;
  status?: number;
};

/**
 * Wraps a Better Auth client error. The message stays empty when the API sent
 * none, so the UI shows its translated generic copy instead of English text
 * invented here.
 */
export function toWorkspaceMemberError(
  error: AuthClientErrorLike,
): WorkspaceMemberError {
  return new WorkspaceMemberError(error.message ?? "", {
    code: error.code,
    status: error.status,
  });
}

export function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
}

/**
 * Picks the text to show for a failed invite or role change: a translated
 * message for a known code, else the API message, else `fallbackKey`. An error
 * of the project member routes (an HttpError) never shows its English message:
 * those go through `getProjectMemberErrorMessage`, and reaching this mapper with
 * one means the generic text is the honest answer.
 */
export function getWorkspaceMemberErrorMessage(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  const code = readCode(error);
  const knownKey = code ? ERROR_KEYS_BY_CODE[code] : undefined;
  if (knownKey) return t(knownKey);

  if (
    error instanceof Error &&
    !(error instanceof HttpError) &&
    error.message.trim()
  ) {
    return error.message;
  }
  return t(fallbackKey);
}
