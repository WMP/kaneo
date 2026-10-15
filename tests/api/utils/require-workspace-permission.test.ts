import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  instanceAdmin: false,
  standing: null as {
    owner: boolean;
    statements: Record<string, string[]> | null;
  } | null,
}));

vi.mock("../../../apps/api/src/utils/is-instance-admin", () => ({
  isInstanceAdmin: async () => mocks.instanceAdmin,
}));
vi.mock("../../../apps/api/src/utils/project-access", async (original) => ({
  ...(await original<
    typeof import("../../../apps/api/src/utils/project-access")
  >()),
  workspaceMemberStanding: async () => mocks.standing,
}));

import { ApiError } from "../../../apps/api/src/errors/api-error";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../../../apps/api/src/utils/require-workspace-permission";

function context(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as unknown as Context;
}

const base = { userId: "user-1", workspaceId: "workspace-1" };

function projectAccess(statements: Record<string, string[]>) {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    mode: "member",
    statements,
    unrestricted: false,
    role: "member",
    workspaceStatements: null,
  };
}

async function denial(
  permissions: Record<string, string[]>,
  values: Record<string, unknown>,
) {
  try {
    await requireWorkspacePermission(permissions)(
      context(values),
      async () => {},
    );
  } catch (error) {
    return error;
  }
  return null;
}

beforeEach(() => {
  mocks.instanceAdmin = false;
  mocks.standing = null;
});

describe("requireWorkspacePermission", () => {
  it("names the permissions a project role lacks", async () => {
    const error = await denial(
      { task: ["read", "update"] },
      { ...base, projectAccess: projectAccess({ task: ["read"] }) },
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["task:update"],
    });
  });

  it("judges workspace-level resources by the workspace role, not the project role", async () => {
    // The project role holds everything, the workspace role only reads.
    mocks.standing = { owner: false, statements: { workspace: ["read"] } };
    const access = projectAccess({
      workspace: ["manage_settings"],
      task: ["read"],
    });

    const error = await denial(
      { workspace: ["manage_settings"] },
      { ...base, projectAccess: access },
    );

    expect(error).toMatchObject({
      code: "MISSING_PERMISSION",
      missingPermissions: ["workspace:manage_settings"],
    });
  });

  it("answers an API key scope that is too narrow with its own code", async () => {
    const error = await denial(
      { task: ["update"] },
      {
        ...base,
        projectAccess: { ...projectAccess({ task: ["update"] }) },
        apiKey: { permissions: { task: ["read"] } },
      },
    );

    expect(error).toMatchObject({
      status: 403,
      code: "API_KEY_SCOPE",
      missingPermissions: ["task:update"],
    });
  });

  it("lets an owner through and fails closed for a non-member", async () => {
    mocks.standing = { owner: true, statements: null };
    expect(await denial({ workspace: ["manage_settings"] }, base)).toBeNull();

    mocks.standing = null;
    expect(await denial({ workspace: ["read"] }, base)).toMatchObject({
      code: "MISSING_PERMISSION",
      missingPermissions: ["workspace:read"],
    });
  });

  it("answers 401 without a user", async () => {
    expect(
      await denial({ workspace: ["read"] }, { workspaceId: "workspace-1" }),
    ).toMatchObject({ status: 401 });
  });
});

describe("hasWorkspacePermission and workspacePermissionChecker", () => {
  it("never widens: a composite role the catalog does not know grants nothing", async () => {
    // `workspaceMemberStanding` resolves "a,b" as one unknown name.
    mocks.standing = { owner: false, statements: null };

    expect(
      await hasWorkspacePermission(context(base), { task: ["read"] }),
    ).toBe(false);
    const allows = await workspacePermissionChecker(context(base));
    expect(allows({ task: ["read"] })).toBe(false);
  });

  it("gives an instance administrator everything, limited by the API key scope", async () => {
    mocks.instanceAdmin = true;
    const allows = await workspacePermissionChecker(
      context({ ...base, apiKey: { permissions: { task: ["read"] } } }),
    );

    expect(allows({ task: ["read"] })).toBe(true);
    expect(allows({ task: ["update"] })).toBe(false);
  });
});
