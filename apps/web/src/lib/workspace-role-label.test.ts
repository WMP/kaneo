import { describe, expect, it } from "vitest";
import { getWorkspaceRoleLabel } from "./workspace-role-label";

const t = (key: string) => `[${key}]`;

describe("getWorkspaceRoleLabel", () => {
  it.each(["viewer", "member", "admin", "owner"])(
    "translates the built-in role %s",
    (role) => {
      expect(getWorkspaceRoleLabel(role, t)).toBe(`[team:roles.${role}]`);
    },
  );

  it("capitalizes a single-word custom role", () => {
    expect(getWorkspaceRoleLabel("reviewer", t)).toBe("Reviewer");
  });

  it("capitalizes every word of a custom role, like the old CSS did", () => {
    expect(getWorkspaceRoleLabel("release manager", t)).toBe("Release Manager");
    expect(getWorkspaceRoleLabel("qa-lead", t)).toBe("Qa-Lead");
  });

  it("leaves the rest of each word untouched", () => {
    expect(getWorkspaceRoleLabel("QA lead", t)).toBe("QA Lead");
    expect(getWorkspaceRoleLabel("", t)).toBe("");
  });

  it("does not mistake an inherited property for a built-in role", () => {
    expect(getWorkspaceRoleLabel("constructor", t)).toBe("Constructor");
  });
});
