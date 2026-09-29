import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  getProjectMemberErrorMessage,
  ProjectMemberError,
  readProjectApiError,
} from "./project-member-error";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}|${JSON.stringify(options)}` : key;

describe("readProjectApiError", () => {
  it("reads the code and message of a JSON error body", async () => {
    const error = await readProjectApiError(
      Response.json(
        { code: "ALREADY_WORKSPACE_MEMBER", message: "Already a member" },
        { status: 409 },
      ),
    );

    expect(error).toBeInstanceOf(ProjectMemberError);
    expect(error).toMatchObject({
      code: "ALREADY_WORKSPACE_MEMBER",
      status: 409,
      message: "Already a member",
    });
  });

  it("maps the stable plain-text messages of the member API to codes", async () => {
    const error = await readProjectApiError(
      new Response(
        "You cannot manage a member with permissions you do not have",
        {
          status: 403,
        },
      ),
    );

    expect(error).toMatchObject({
      code: "YOU_CANNOT_MANAGE_THIS_MEMBER",
      status: 403,
    });
  });

  it("keeps a plain-text 403 from the access middleware without a code", async () => {
    const error = await readProjectApiError(
      new Response("No access to the project", { status: 403 }),
    );

    expect(error).toMatchObject({ status: 403, code: undefined });
  });

  it("reads Retry-After of a rate limit", async () => {
    const error = (await readProjectApiError(
      Response.json(
        { code: "RATE_LIMITED", message: "Too many invitations" },
        { status: 429, headers: { "Retry-After": "17" } },
      ),
    )) as ProjectMemberError;

    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(17);
  });

  it("ignores a Retry-After that is not a positive number", async () => {
    const error = (await readProjectApiError(
      Response.json(
        { code: "RATE_LIMITED", message: "x" },
        { status: 429, headers: { "Retry-After": "soon" } },
      ),
    )) as ProjectMemberError;

    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("keeps a 401 an HttpError so the query cache redirects to sign-in", async () => {
    const error = await readProjectApiError(
      new Response("Unauthorized", { status: 401 }),
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(401);
  });
});

describe("getProjectMemberErrorMessage", () => {
  const fail = (code: string | undefined, status: number, seconds?: number) =>
    new ProjectMemberError("English", {
      code,
      status,
      retryAfterSeconds: seconds,
    });

  it.each([
    [
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      "projectMembers:errors.roleExceedsYourPermissions",
    ],
    [
      "YOU_CANNOT_MANAGE_THIS_MEMBER",
      "projectMembers:errors.cannotManageMember",
    ],
    ["OWNER_ROLE_NOT_ALLOWED", "projectMembers:errors.ownerRoleNotAllowed"],
    ["UNKNOWN_ROLE", "projectMembers:errors.unknownRole"],
    ["MEMBER_HAS_FULL_ACCESS", "projectMembers:errors.memberHasFullAccess"],
    [
      "ALREADY_WORKSPACE_MEMBER",
      "projectInvitations:errors.alreadyWorkspaceMember",
    ],
    ["INVITATION_ROLE_CONFLICT", "projectInvitations:errors.roleConflict"],
    [
      "WORKSPACE_INVITATION_EXISTS",
      "projectInvitations:errors.workspaceInvitationExists",
    ],
    ["INVITATION_EXPIRED", "projectInvitations:errors.expired"],
    [
      "DISPOSABLE_EMAIL_NOT_ALLOWED",
      "projectInvitations:errors.disposableEmail",
    ],
    ["PROJECT_INVITATION_NOT_APPLIED", "projectInvitations:errors.notApplied"],
    ["PROJECT_MEMBERSHIP_CHANGED", "projectMembers:errors.membershipChanged"],
  ])("maps %s", (code, key) => {
    expect(getProjectMemberErrorMessage(fail(code, 400), t, "fallback")).toBe(
      key,
    );
  });

  it("names the wait of a rate limit when the API sent one", () => {
    expect(
      getProjectMemberErrorMessage(
        fail("RATE_LIMITED", 429, 30),
        t,
        "fallback",
      ),
    ).toBe('projectInvitations:errors.rateLimitedRetry|{"seconds":30}');
  });

  it("has a rate limit message without a wait", () => {
    expect(
      getProjectMemberErrorMessage(fail("RATE_LIMITED", 429), t, "fallback"),
    ).toBe("projectInvitations:errors.rateLimited");
  });

  it("explains a plain 403 as missing permission", () => {
    expect(
      getProjectMemberErrorMessage(fail(undefined, 403), t, "fallback"),
    ).toBe("projectMembers:errors.insufficientPermissions");
  });

  it("tells a 409 without a known code to retry", () => {
    expect(
      getProjectMemberErrorMessage(fail(undefined, 409), t, "fallback"),
    ).toBe("projectMembers:errors.membershipChanged");
  });

  it("never shows the English API message, only the translated fallback", () => {
    expect(
      getProjectMemberErrorMessage(fail(undefined, 500), t, "fallback"),
    ).toBe("fallback");
    expect(getProjectMemberErrorMessage(new Error("boom"), t, "fallback")).toBe(
      "fallback",
    );
    expect(getProjectMemberErrorMessage(null, t, "fallback")).toBe("fallback");
  });
});
