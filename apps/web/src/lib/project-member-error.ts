import { HttpError, isForbiddenError } from "@/lib/http-error";
import { readCode } from "@/lib/workspace-role-error";

// Errors of the project member and project invitation routes. They answer JSON
// `{ code, message }`; the shared access middleware answers the message as plain
// text, which has no code. The UI branches on the code and never on English.

type ProjectMemberErrorInit = {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
};

/**
 * An HttpError, so everything that reads HTTP semantics (the sign-in redirect on
 * 401, connectivity tracking and the unreachable banner on 502/503/504, the
 * retry policy) treats it like any other failed request. It also keeps the API
 * `code` and the `Retry-After` of a rate limit.
 */
export class ProjectMemberError extends HttpError {
  code?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    { status, code, retryAfterSeconds }: ProjectMemberErrorInit,
  ) {
    super(status, message);
    this.name = "ProjectMemberError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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
    // Plain text: the shared access middleware's message, which has no code.
  }
  return { message: trimmed };
}

/** Turns a failed response into the error a fetcher throws. */
export async function readProjectApiError(
  response: Response,
): Promise<ProjectMemberError> {
  const text = await response.text().catch(() => "");
  const { code, message } = parseBody(text);
  const retryAfter = Number.parseInt(
    response.headers.get("Retry-After") ?? "",
    10,
  );
  return new ProjectMemberError(message, {
    code,
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
  USER_CANNOT_BE_ADDED: "people:errors.userCannotBeAdded",
  USER_DIRECTORY_DISABLED: "people:errors.directoryDisabled",
  GUEST_NOT_ALLOWED: "people:errors.guestNotAllowed",
  WORKSPACE_MEMBER_LIMIT_REACHED: "people:errors.membershipLimitReached",
  // Better Auth's own code, when accepting an invitation hits the same limit.
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: "people:errors.membershipLimitReached",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

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
  const code = readCode(error);
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
