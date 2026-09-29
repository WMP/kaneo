import { describe, expect, it } from "vitest";
import {
  getWorkspaceMemberErrorMessage,
  toWorkspaceMemberError,
  WorkspaceMemberError,
} from "./workspace-role-error";

const t = (key: string) => `[${key}]`;
const FALLBACK = "team:inviteModal.error";

describe("getWorkspaceMemberErrorMessage", () => {
  it.each([
    ["ROLE_EXCEEDS_YOUR_PERMISSIONS", "team:errors.roleExceedsYourPermissions"],
    ["YOU_CANNOT_CHANGE_YOUR_OWN_ROLE", "team:errors.cannotChangeOwnRole"],
    ["YOU_CANNOT_MANAGE_THIS_MEMBER", "team:errors.cannotManageMember"],
    [
      "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
      "team:errors.cannotUpdateMember",
    ],
    [
      "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
      "team:errors.cannotInviteWithRole",
    ],
    [
      "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
      "team:errors.alreadyMember",
    ],
    [
      "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
      "team:errors.alreadyInvited",
    ],
    ["INVITATION_LIMIT_REACHED", "team:errors.invitationLimitReached"],
  ])("maps %s to a translated key", (code, key) => {
    const error = new WorkspaceMemberError("English API text", { code });
    expect(getWorkspaceMemberErrorMessage(error, t, FALLBACK)).toBe(`[${key}]`);
  });

  it("prefers the translated key over the API message for a known code", () => {
    const error = toWorkspaceMemberError({
      code: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      message: "Role exceeds your permissions",
      status: 403,
    });
    expect(getWorkspaceMemberErrorMessage(error, t, FALLBACK)).toBe(
      "[team:errors.roleExceedsYourPermissions]",
    );
  });

  it("falls back to the API message for an unknown code", () => {
    const error = new WorkspaceMemberError("Something specific happened", {
      code: "SOMETHING_ELSE",
    });
    expect(getWorkspaceMemberErrorMessage(error, t, FALLBACK)).toBe(
      "Something specific happened",
    );
  });

  it("falls back to the API message for a plain Error without a code", () => {
    expect(getWorkspaceMemberErrorMessage(new Error("Boom"), t, FALLBACK)).toBe(
      "Boom",
    );
  });

  it("falls back to the generic key when the API sent no message", () => {
    const error = toWorkspaceMemberError({ status: 500 });
    expect(getWorkspaceMemberErrorMessage(error, t, FALLBACK)).toBe(
      `[${FALLBACK}]`,
    );
  });

  it("falls back to the generic key for a blank message", () => {
    expect(getWorkspaceMemberErrorMessage(new Error("   "), t, FALLBACK)).toBe(
      `[${FALLBACK}]`,
    );
  });

  it("falls back to the generic key for non-Error values", () => {
    expect(getWorkspaceMemberErrorMessage("nope", t, FALLBACK)).toBe(
      `[${FALLBACK}]`,
    );
    expect(getWorkspaceMemberErrorMessage(null, t, FALLBACK)).toBe(
      `[${FALLBACK}]`,
    );
  });

  it("reads a code from an error-shaped object", () => {
    expect(
      getWorkspaceMemberErrorMessage(
        { code: "INVITATION_LIMIT_REACHED" },
        t,
        FALLBACK,
      ),
    ).toBe("[team:errors.invitationLimitReached]");
  });
});

describe("toWorkspaceMemberError", () => {
  it("keeps the code, status and message", () => {
    const error = toWorkspaceMemberError({
      code: "YOU_CANNOT_MANAGE_THIS_MEMBER",
      message: "nope",
      status: 403,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("YOU_CANNOT_MANAGE_THIS_MEMBER");
    expect(error.status).toBe(403);
    expect(error.message).toBe("nope");
  });
});
