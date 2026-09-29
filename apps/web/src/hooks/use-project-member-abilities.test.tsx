import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { useProjectMemberAbilities } from "./use-project-member-abilities";

type Permission = {
  addMembers: boolean;
  inviteToProject: boolean;
  manageMembers: boolean;
  cancelProjectInvitations: boolean;
  isCheckingPermissions: boolean;
  isError: boolean;
  error: unknown;
};

const ALLOWED: Permission = {
  addMembers: true,
  inviteToProject: true,
  manageMembers: true,
  cancelProjectInvitations: true,
  isCheckingPermissions: false,
  isError: false,
  error: null,
};
const DENIED: Permission = {
  addMembers: false,
  inviteToProject: false,
  manageMembers: false,
  cancelProjectInvitations: false,
  isCheckingPermissions: false,
  isError: false,
  error: null,
};

let permission: Permission;
const invalidateQueries = vi.fn();
const rolesOptions = vi.fn();

type RolesQuery = {
  data?: { role: string; isDefault: boolean }[];
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
let roles: RolesQuery;

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({
    canAddMembers: () => permission.addMembers,
    canInviteToProject: () => permission.inviteToProject,
    canManageMembers: () => permission.manageMembers,
    canCancelProjectInvitations: () => permission.cancelProjectInvitations,
    isCheckingPermissions: permission.isCheckingPermissions,
    isError: permission.isError,
    error: permission.error,
  }),
}));

vi.mock(
  "@/hooks/queries/project-member/use-get-project-assignable-roles",
  () => ({
    default: (projectId: string, options: unknown) => {
      rolesOptions(projectId, options);
      return roles;
    },
  }),
);

const ROLES = [{ role: "member", isDefault: true }];
const loaded = (): RolesQuery => ({
  data: ROLES,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  permission = { ...ALLOWED };
  roles = loaded();
  invalidateQueries.mockReset();
  rolesOptions.mockReset();
});

const abilities = () =>
  renderHook(() => useProjectMemberAbilities("project-1")).result.current;

describe("useProjectMemberAbilities", () => {
  it("allows what the project capabilities allow", () => {
    expect(abilities()).toMatchObject({
      isLoading: false,
      hasError: false,
      canAdd: true,
      canInvite: true,
      canManage: true,
      canCancelInvitations: true,
      canViewInvitations: true,
    });
  });

  it("offers nothing when the capabilities are all false", () => {
    permission = { ...DENIED };

    expect(abilities()).toMatchObject({
      canAdd: false,
      canInvite: false,
      canManage: false,
      canCancelInvitations: false,
      canViewInvitations: false,
    });
  });

  it("asks for the assignable roles only when a capability needs them", () => {
    permission = { ...DENIED };
    abilities();
    expect(rolesOptions).toHaveBeenLastCalledWith("project-1", {
      enabled: false,
    });

    permission = { ...DENIED, inviteToProject: true };
    abilities();
    expect(rolesOptions).toHaveBeenLastCalledWith("project-1", {
      enabled: true,
    });
  });

  it("cannot add or invite without an assignable role, but can still manage and cancel", () => {
    roles = { ...loaded(), data: [] };

    expect(abilities()).toMatchObject({
      canAdd: false,
      canInvite: false,
      canManage: true,
      canCancelInvitations: true,
    });
  });

  it("can add but not invite when only member:create is granted", () => {
    permission = { ...DENIED, addMembers: true };

    expect(abilities()).toMatchObject({
      canAdd: true,
      canInvite: false,
      canViewInvitations: false,
    });
  });

  it("can view the invitation list with either invitation right", () => {
    permission = { ...DENIED, cancelProjectInvitations: true };
    expect(abilities().canViewInvitations).toBe(true);

    permission = { ...DENIED, inviteToProject: true };
    expect(abilities().canViewInvitations).toBe(true);
  });

  it("is loading, and offers nothing, until the capabilities are known", () => {
    permission = { ...DENIED, isCheckingPermissions: true };

    expect(abilities()).toMatchObject({ isLoading: true, canAdd: false });
  });

  it("is loading while a needed role list is still pending", () => {
    roles = { ...loaded(), data: undefined, isPending: true };

    expect(abilities().isLoading).toBe(true);
  });

  it("does not call a 403 an error: the project answers all false", () => {
    permission = {
      ...DENIED,
      isError: true,
      error: new HttpError(403, "No access"),
    };

    expect(abilities().hasError).toBe(false);
  });

  it("treats a failed capability answer that is not a 403 as unknown, with an error and a retry, not as no rights", () => {
    permission = {
      ...DENIED,
      isError: true,
      error: new HttpError(500, "boom"),
    };

    const result = abilities();
    expect(result.hasError).toBe(true);
    expect(result.canAdd).toBe(false);

    result.retry();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-access", "project-1"],
    });
  });

  it("reports a failed role list and retries only that", () => {
    roles = { ...loaded(), data: undefined, isError: true };

    const result = abilities();
    expect(result.hasError).toBe(true);
    expect(result.assignableRoles).toBeUndefined();
    expect(result.assignableRolesFailed).toBe(true);

    result.retry();
    expect(roles.refetch).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
