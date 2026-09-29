import { HttpError, isForbiddenError } from "@/lib/http-error";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";

// Errors of the project member and project invitation routes. The invitation
// routes answer JSON `{ code, message }`; the member routes and the shared
// access middleware answer the message as plain text. Both are read here into
// one error with a `code`, so the UI branches on a code and never on English.

type ProjectMemberErrorInit = {
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
};

export class ProjectMemberError extends WorkspaceMemberError {
  retryAfterSeconds?: number;

  constructor(
    message: string,
    { code, status, retryAfterSeconds }: ProjectMemberErrorInit = {},
  ) {
    super(message, { code, status });
    this.name = "ProjectMemberError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// The stable plain-text messages of the member API (see PROJECT_MEMBER_ERRORS
// in apps/api/src/project-member/delegation.ts, part of its documented
// contract) mapped to the codes the invitation API uses where one exists.
const CODES_BY_MESSAGE: Record<string, string> = {
  "The owner role cannot be a project role": "OWNER_ROLE_NOT_ALLOWED",
  "Unknown role": "UNKNOWN_ROLE",
  "You cannot assign a role with permissions you do not have":
    "ROLE_EXCEEDS_YOUR_PERMISSIONS",
  "You cannot manage a member with permissions you do not have":
    "YOU_CANNOT_MANAGE_THIS_MEMBER",
  "You cannot change your own project role": "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
  "Members with full access cannot be changed or removed at project level":
    "MEMBER_HAS_FULL_ACCESS",
  "User already has full access to this project": "USER_HAS_FULL_ACCESS",
  "User is already a member of this project": "ALREADY_PROJECT_MEMBER",
  "User is not a member of this workspace": "NOT_WORKSPACE_MEMBER",
  "User is not a member of this project": "NOT_PROJECT_MEMBER",
  "The project membership changed, please retry": "PROJECT_MEMBERSHIP_CHANGED",
  "Insufficient permissions": "INSUFFICIENT_PERMISSIONS",
  "Insufficient API key scope": "INSUFFICIENT_API_KEY_SCOPE",
};

function parseBody(text: string): { code?: string; message: string } {
  const trimmed = text.trim();
  try {
    const body: unknown = JSON.parse(trimmed);
    if (typeof body === "object" && body !== null) {
      const { code, message } = body as { code?: unknown; message?: unknown };
      return {
        code: typeof code === "string" && code ? code : undefined,
        message: typeof message === "string" ? message : "",
      };
    }
  } catch {
    // Plain text: the message itself.
  }
  return { message: trimmed };
}

/** Turns a failed response into the error a fetcher throws. */
export async function readProjectApiError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  // A 401 keeps its HttpError shape: the query cache redirects to sign-in.
  if (response.status === 401) return new HttpError(401, text);

  const { code, message } = parseBody(text);
  const retryAfter = Number.parseInt(
    response.headers.get("Retry-After") ?? "",
    10,
  );
  return new ProjectMemberError(message, {
    code: code ?? CODES_BY_MESSAGE[message],
    status: response.status,
    retryAfterSeconds:
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  });
}

// Static keys keep the i18n checker able to see every string in use.
const ERROR_KEYS_BY_CODE: Record<string, string> = {
  ROLE_EXCEEDS_YOUR_PERMISSIONS:
    "projectMembers:errors.roleExceedsYourPermissions",
  YOU_CANNOT_MANAGE_THIS_MEMBER: "projectMembers:errors.cannotManageMember",
  YOU_CANNOT_CHANGE_YOUR_OWN_ROLE: "projectMembers:errors.cannotChangeOwnRole",
  OWNER_ROLE_NOT_ALLOWED: "projectMembers:errors.ownerRoleNotAllowed",
  UNKNOWN_ROLE: "projectMembers:errors.unknownRole",
  MEMBER_HAS_FULL_ACCESS: "projectMembers:errors.memberHasFullAccess",
  USER_HAS_FULL_ACCESS: "projectMembers:errors.userHasFullAccess",
  ALREADY_PROJECT_MEMBER: "projectMembers:errors.alreadyProjectMember",
  NOT_WORKSPACE_MEMBER: "projectMembers:errors.notWorkspaceMember",
  NOT_PROJECT_MEMBER: "projectMembers:errors.notProjectMember",
  PROJECT_MEMBERSHIP_CHANGED: "projectMembers:errors.membershipChanged",
  INSUFFICIENT_PERMISSIONS: "projectMembers:errors.insufficientPermissions",
  INSUFFICIENT_API_KEY_SCOPE: "projectMembers:errors.insufficientPermissions",
  ALREADY_WORKSPACE_MEMBER: "projectInvitations:errors.alreadyWorkspaceMember",
  INVITATION_ROLE_CONFLICT: "projectInvitations:errors.roleConflict",
  WORKSPACE_INVITATION_EXISTS:
    "projectInvitations:errors.workspaceInvitationExists",
  INVITATION_EXPIRED: "projectInvitations:errors.expired",
  INVITATION_NOT_FOUND: "projectInvitations:errors.notFound",
  INVITATION_LIMIT_REACHED: "projectInvitations:errors.limitReached",
  GUEST_CANNOT_INVITE: "projectInvitations:errors.guestCannotInvite",
  DISPOSABLE_EMAIL_NOT_ALLOWED: "projectInvitations:errors.disposableEmail",
  PROJECT_INVITATION_NOT_APPLIED: "projectInvitations:errors.notApplied",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
}

/**
 * The text for a failed project member or invitation request: a translated
 * message for a known code, for a rate limit (with the wait when the API sent
 * one), for a plain 403 or a 409; otherwise the translated `fallbackKey`.
 * The API's own English message is never shown.
 */
export function getProjectMemberErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: string,
): string {
  const code = getErrorCode(error);
  if (code === "RATE_LIMITED") {
    const seconds = (error as ProjectMemberError).retryAfterSeconds;
    return seconds
      ? t("projectInvitations:errors.rateLimitedRetry", { seconds })
      : t("projectInvitations:errors.rateLimited");
  }
  const knownKey = code ? ERROR_KEYS_BY_CODE[code] : undefined;
  if (knownKey) return t(knownKey);

  const status = (error as { status?: unknown } | null)?.status;
  if (isForbiddenError(error)) {
    return t("projectMembers:errors.insufficientPermissions");
  }
  if (status === 409) return t("projectMembers:errors.membershipChanged");
  return t(fallbackKey);
}
