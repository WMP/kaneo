import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import ProjectMembersSection from "./project-members-section";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "me" } }),
}));

type Abilities = {
  isLoading: boolean;
  hasError: boolean;
  retry: () => void;
  assignableRoles: { role: string; isDefault: boolean }[] | undefined;
  assignableRolesFailed: boolean;
  refetchAssignableRoles: () => void;
  canAdd: boolean;
  canInvite: boolean;
  canManage: boolean;
  canCancelInvitations: boolean;
  canViewInvitations: boolean;
};
const ALL: Abilities = {
  isLoading: false,
  hasError: false,
  retry: vi.fn(),
  assignableRoles: [{ role: "member", isDefault: true }],
  assignableRolesFailed: false,
  refetchAssignableRoles: vi.fn(),
  canAdd: true,
  canInvite: true,
  canManage: true,
  canCancelInvitations: true,
  canViewInvitations: true,
};
let abilities: Abilities;

vi.mock("@/hooks/use-project-member-abilities", () => ({
  useProjectMemberAbilities: () => abilities,
}));

const refetchMembers = vi.fn();
let membersState: {
  data: unknown;
  error: unknown;
  isLoading: boolean;
};
vi.mock("@/hooks/queries/project-member/use-get-project-members", () => ({
  default: () => ({ ...membersState, refetch: refetchMembers }),
}));
vi.mock(
  "@/hooks/queries/project-invitation/use-get-project-invitations",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock("@/hooks/queries/project-member/use-get-member-candidates", () => ({
  default: () => ({ data: [{ id: "u-7", email: "carol@example.com" }] }),
}));
const useGetAssignableRoles = vi.fn((_workspaceId: string | undefined) => ({
  data: [],
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: (workspaceId: string | undefined) =>
    useGetAssignableRoles(workspaceId),
}));

type DialogProps = Record<string, unknown> & { open: boolean };
let inviteProps: DialogProps | undefined;
let addProps: DialogProps | undefined;

vi.mock("./project-members-table", () => ({
  default: (props: { canManage: boolean }) => (
    <div>table canManage={String(props.canManage)}</div>
  ),
}));
vi.mock("./project-invitations-list", () => ({
  default: () => <div>invitations list</div>,
}));
vi.mock("./add-project-member-dialog", () => ({
  default: (props: DialogProps) => {
    addProps = props;
    return props.open ? <div>add dialog</div> : null;
  },
}));
vi.mock("./invite-to-project-dialog", () => ({
  default: (props: DialogProps) => {
    inviteProps = props;
    return props.open ? <div>invite dialog</div> : null;
  },
}));

const renderSection = () =>
  render(
    <ProjectMembersSection
      projectId="project-1"
      workspaceId="workspace-1"
      onLeft={vi.fn()}
    />,
  );

beforeEach(() => {
  abilities = { ...ALL };
  membersState = { data: [], error: null, isLoading: false };
  inviteProps = undefined;
  addProps = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectMembersSection", () => {
  it("offers add member and invite by email to a caller who may do both", () => {
    renderSection();

    expect(
      screen.getByRole("button", { name: "projectMembers:addMember" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "projectMembers:inviteByEmail" }),
    ).toBeVisible();
    expect(screen.getByText("invitations list")).toBeVisible();
  });

  it("offers neither, and no invitation list, to a caller the API refuses", () => {
    abilities = {
      ...ALL,
      canAdd: false,
      canInvite: false,
      canManage: false,
      canCancelInvitations: false,
      canViewInvitations: false,
    };
    renderSection();

    expect(
      screen.queryByRole("button", { name: "projectMembers:addMember" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "projectMembers:inviteByEmail" }),
    ).toBeNull();
    expect(screen.queryByText("invitations list")).toBeNull();
    expect(screen.getByText("table canManage=false")).toBeVisible();
  });

  it("shows no action buttons while the abilities are still loading", () => {
    abilities = { ...ALL, isLoading: true };
    renderSection();

    expect(
      screen.queryByRole("button", { name: "projectMembers:addMember" }),
    ).toBeNull();
  });

  it("shows the no-access state when the member list answers 403", () => {
    membersState = {
      data: undefined,
      error: new HttpError(403, "No access to the project"),
      isLoading: false,
    };
    renderSection();

    expect(screen.getByText("projectMembers:noAccess.title")).toBeVisible();
    expect(screen.queryByText(/^table/)).toBeNull();
  });

  it("shows a load error with a retry for other failures", () => {
    membersState = {
      data: undefined,
      error: new HttpError(500, "boom"),
      isLoading: false,
    };
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "projectMembers:retry" }),
    );
    expect(refetchMembers).toHaveBeenCalledTimes(1);
  });

  it("moves from the invite dialog to the add dialog with the person and role", () => {
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "projectMembers:inviteByEmail" }),
    );
    expect(screen.getByText("invite dialog")).toBeVisible();

    const onAdd = inviteProps?.onAddExistingMember as
      | ((member: { userId: string; role: string }) => void)
      | undefined;
    expect(onAdd).toBeDefined();
    act(() => {
      onAdd?.({ userId: "u-7", role: "qa-lead" });
    });

    expect(screen.queryByText("invite dialog")).toBeNull();
    expect(screen.getByText("add dialog")).toBeVisible();
    expect(addProps?.initial).toEqual({ userId: "u-7", role: "qa-lead" });
  });

  it("does not hand candidates to the invite dialog when adding members is not allowed", () => {
    abilities = { ...ALL, canAdd: false };
    renderSection();

    expect(inviteProps?.candidates).toBeUndefined();
    expect(inviteProps?.onAddExistingMember).toBeUndefined();
  });

  it("mounts a dialog only for a caller who can use it", () => {
    abilities = { ...ALL, canAdd: false, canInvite: false };
    renderSection();

    expect(addProps).toBeUndefined();
    expect(inviteProps).toBeUndefined();
  });

  it("mounts both dialogs for a caller who can use them", () => {
    renderSection();

    expect(addProps).toBeDefined();
    expect(inviteProps).toBeDefined();
  });

  it("asks for the workspace assignable roles only when the caller can invite", () => {
    abilities = { ...ALL, canInvite: false };
    renderSection();
    expect(useGetAssignableRoles).toHaveBeenLastCalledWith(undefined);

    cleanup();
    abilities = { ...ALL, canInvite: true };
    renderSection();
    expect(useGetAssignableRoles).toHaveBeenLastCalledWith("workspace-1");
  });

  it("shows an error with a retry when a permission probe failed for another reason than 403", () => {
    abilities = {
      ...ALL,
      hasError: true,
      canAdd: false,
      canInvite: false,
      canViewInvitations: false,
    };
    renderSection();

    expect(screen.getByText("projectMembers:abilitiesError")).toBeVisible();
    fireEvent.click(
      screen.getAllByRole("button", { name: "projectMembers:retry" })[0],
    );
    expect(abilities.retry).toHaveBeenCalledTimes(1);
  });

  it("shows no such error when everything answered", () => {
    renderSection();

    expect(screen.queryByText("projectMembers:abilitiesError")).toBeNull();
  });
});
