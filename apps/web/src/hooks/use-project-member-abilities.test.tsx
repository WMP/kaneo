import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectMemberAbilities } from "./use-project-member-abilities";

type Q = {
  data?: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  refetch: () => void;
};

const ok = (data: unknown): Q => ({
  data,
  isPending: false,
  isSuccess: true,
  isError: false,
  refetch: vi.fn(),
});
const forbidden = (): Q => ({
  data: undefined,
  isPending: false,
  isSuccess: false,
  isError: true,
  refetch: vi.fn(),
});
const pending = (): Q => ({
  data: undefined,
  isPending: true,
  isSuccess: false,
  isError: false,
  refetch: vi.fn(),
});

let roles: Q;
let candidates: Q;
let invitations: Q;

vi.mock(
  "@/hooks/queries/project-member/use-get-project-assignable-roles",
  () => ({ default: () => roles }),
);
vi.mock("@/hooks/queries/project-member/use-get-member-candidates", () => ({
  default: () => candidates,
}));
vi.mock(
  "@/hooks/queries/project-invitation/use-get-project-invitations",
  () => ({
    default: () => invitations,
  }),
);

const ROLES = [{ role: "member", isDefault: true }];

beforeEach(() => {
  roles = ok(ROLES);
  candidates = ok([]);
  invitations = ok([]);
});

const abilities = () =>
  renderHook(() => useProjectMemberAbilities("project-1")).result.current;

describe("useProjectMemberAbilities", () => {
  it("allows everything when the API answers everything", () => {
    expect(abilities()).toMatchObject({
      isLoading: false,
      canAdd: true,
      canInvite: true,
      canManage: true,
      canCancelInvitations: true,
      canViewInvitations: true,
    });
  });

  it("offers nothing to a caller the API refuses everywhere", () => {
    candidates = forbidden();
    invitations = forbidden();

    expect(abilities()).toMatchObject({
      canAdd: false,
      canInvite: false,
      canManage: false,
      canCancelInvitations: false,
      canViewInvitations: false,
    });
  });

  it("cannot add or invite without an assignable role, but can still manage and cancel", () => {
    roles = ok([]);

    expect(abilities()).toMatchObject({
      canAdd: false,
      canInvite: false,
      canManage: true,
      canCancelInvitations: true,
    });
  });

  it("can add but not invite when only the invitation list is refused", () => {
    invitations = forbidden();

    expect(abilities()).toMatchObject({
      canAdd: true,
      canInvite: false,
      canViewInvitations: false,
    });
  });

  it("is loading, and offers nothing, until every answer is known", () => {
    candidates = pending();

    expect(abilities()).toMatchObject({ isLoading: true, canAdd: false });
  });

  it("reports a failed role list so the UI can offer a retry", () => {
    roles = forbidden();

    const result = abilities();
    expect(result.assignableRoles).toBeUndefined();
    expect(result.assignableRolesFailed).toBe(true);
  });
});
