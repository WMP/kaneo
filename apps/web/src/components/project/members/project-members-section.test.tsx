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
let workspaceCanAdd = true;

vi.mock("@/hooks/use-project-member-abilities", () => ({
  useProjectMemberAbilities: () => abilities,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canAddMembers: () => workspaceCanAdd }),
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
const useGetProjectInvitations = vi.fn(
  (_projectId: string, _options: { enabled?: boolean }) => ({ data: [] }),
);
vi.mock(
  "@/hooks/queries/project-invitation/use-get-project-invitations",
  () => ({
    default: (projectId: string, options: { enabled?: boolean }) =>
      useGetProjectInvitations(projectId, options),
  }),
);
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
let dialogProps: DialogProps | undefined;

vi.mock("@/components/people/project-people-table", () => ({
  default: (props: { canManage: boolean }) => (
    <div>table canManage={String(props.canManage)}</div>
  ),
}));
let pendingProps: Record<string, unknown> | undefined;
vi.mock("@/components/people/project-pending-invitations", () => ({
  default: (props: Record<string, unknown>) => {
    pendingProps = props;
    return <div>invitations list</div>;
  },
}));
vi.mock("@/components/people/add-people-dialog", () => ({
  default: (props: DialogProps) => {
    dialogProps = props;
    return props.open ? <div>add people dialog</div> : null;
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
  workspaceCanAdd = true;
  membersState = { data: [], error: null, isLoading: false };
  dialogProps = undefined;
  pendingProps = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectMembersSection", () => {
  it("offers one Add people button to a caller who may add or invite", () => {
    renderSection();

    expect(
      screen.getByRole("button", { name: "people:add.open" }),
    ).toBeVisible();
    expect(screen.getByText("invitations list")).toBeVisible();
  });

  it("offers the button to a caller who can only invite, or only add", () => {
    abilities = { ...ALL, canAdd: false };
    const { unmount } = renderSection();
    expect(
      screen.getByRole("button", { name: "people:add.open" }),
    ).toBeVisible();
    unmount();

    abilities = { ...ALL, canInvite: false };
    renderSection();
    expect(
      screen.getByRole("button", { name: "people:add.open" }),
    ).toBeVisible();
  });

  it("offers nothing, and no invitation list, to a caller the API refuses", () => {
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
      screen.queryByRole("button", { name: "people:add.open" }),
    ).toBeNull();
    expect(screen.queryByText("invitations list")).toBeNull();
    expect(screen.getByText("table canManage=false")).toBeVisible();
  });

  it("shows no action button while the abilities are still loading", () => {
    abilities = { ...ALL, isLoading: true };
    renderSection();

    expect(
      screen.queryByRole("button", { name: "people:add.open" }),
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

  it("opens the add people dialog in the project context with what the caller may do", () => {
    renderSection();

    expect(screen.queryByText("add people dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "people:add.open" }));

    expect(screen.getByText("add people dialog")).toBeVisible();
    expect(dialogProps).toMatchObject({
      open: true,
      context: {
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
      canAdd: true,
      canInvite: true,
      canAddToWorkspace: true,
    });
  });

  it("tells the dialog when the caller may not add accounts to the workspace", () => {
    workspaceCanAdd = false;
    renderSection();

    expect(dialogProps).toMatchObject({
      canAdd: true,
      canAddToWorkspace: false,
    });
  });

  it("opens the dialog on an expired invitation with its address and roles", () => {
    renderSection();

    const onInviteAgain = pendingProps?.onInviteAgain as
      | ((invitation: Record<string, string>) => void)
      | undefined;
    expect(onInviteAgain).toBeDefined();
    act(() => {
      onInviteAgain?.({
        email: "old@example.com",
        workspaceRole: "viewer",
        projectRole: "tester",
      });
    });

    expect(screen.getByText("add people dialog")).toBeVisible();
    expect(dialogProps?.prefill).toEqual({
      email: "old@example.com",
      workspaceRole: "viewer",
      projectRole: "tester",
    });
  });

  it("mounts the dialog only for a caller who can use it", () => {
    abilities = { ...ALL, canAdd: false, canInvite: false };
    renderSection();

    expect(dialogProps).toBeUndefined();
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

  it("reads the invitation list only when the capabilities allow it", () => {
    abilities = {
      ...ALL,
      canAdd: false,
      canInvite: false,
      canViewInvitations: false,
    };
    renderSection();
    expect(useGetProjectInvitations).toHaveBeenLastCalledWith("project-1", {
      enabled: false,
    });

    cleanup();
    abilities = { ...ALL };
    renderSection();
    expect(useGetProjectInvitations).toHaveBeenLastCalledWith("project-1", {
      enabled: true,
    });
  });
});
