import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePerson } from "@/fetchers/workspace/get-workspace-people";
import WorkspacePeopleTable from "./workspace-people-table";

const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options ? `${key}:${options.count}` : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "Sep 1, 2026",
}));

const deleteWorkspaceUser = vi.fn();
vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: deleteWorkspaceUser, isPending: false }),
}));

const updateMemberRole = vi.fn();
vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: updateMemberRole }),
  }),
);

const refetchAssignableRoles = vi.fn();
type AssignableRolesState = {
  data: { role: string; isDefault: boolean }[] | undefined;
  isError?: boolean;
};
const DEFAULT_ASSIGNABLE_ROLES = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "qa-lead", isDefault: false },
];
let assignableRoles: AssignableRolesState = {
  data: DEFAULT_ASSIGNABLE_ROLES,
};
vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => ({ ...assignableRoles, refetch: refetchAssignableRoles }),
}));

const canManageTeam = vi.fn(() => true);
const canRemoveMembers = vi.fn(() => true);
let isOwner = false;
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => canManageTeam(),
    canRemoveMembers: () => canRemoveMembers(),
    isOwner,
  }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
  canManageTeam.mockReturnValue(true);
  canRemoveMembers.mockReturnValue(true);
  isOwner = false;
  assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES };
  updateMemberRole.mockResolvedValue({});
  deleteWorkspaceUser.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const person = (
  id: string,
  role: string,
  overrides: Partial<WorkspacePerson> = {},
): WorkspacePerson =>
  ({
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    role,
    memberId: `member-${id}`,
    joinedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as WorkspacePerson;

const renderPeople = (people: WorkspacePerson[]) =>
  render(<WorkspacePeopleTable workspaceId="workspace-1" people={people} />);

describe("WorkspacePeopleTable layout", () => {
  it("shows person, workspace role and joined date, owner first", () => {
    renderPeople([person("ada", "member"), person("root", "owner")]);

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "people:table.columns.person",
      "people:table.columns.workspaceRole",
      "people:table.columns.joined",
      "",
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("root@example.com")).toBeVisible();
    expect(within(rows[1]).getByText("ada@example.com")).toBeVisible();
    expect(within(rows[1]).getByText("Sep 1, 2026")).toBeVisible();
  });

  it("marks the caller's own row", () => {
    renderPeople([person("current-user", "member")]);
    expect(screen.getByText("(people:table.you)")).toBeVisible();
  });

  it("shows an empty state without people", () => {
    renderPeople([]);
    expect(screen.getByText("team:membersTable.emptyTitle")).toBeVisible();
  });

  it("shows a dash when the join date is unknown", () => {
    renderPeople([person("ada", "member", { joinedAt: null as never })]);
    expect(screen.getByText("–")).toBeVisible();
  });
});

describe("WorkspacePeopleTable projects column", () => {
  it("is left out when the API sent no project data", () => {
    renderPeople([person("ada", "member")]);

    expect(
      screen.queryByRole("columnheader", {
        name: "people:table.columns.projects",
      }),
    ).toBeNull();
  });

  it("lists the projects with the project role, or full access", () => {
    renderPeople([
      person("ada", "member", {
        fullAccess: false,
        projects: [
          { id: "p1", name: "Alpha", role: "member" },
          { id: "p2", name: "Beta", role: "viewer" },
        ],
      }),
      person("boss", "admin", { fullAccess: true, projects: [] }),
      person("idle", "viewer", { fullAccess: false, projects: [] }),
    ]);

    expect(
      screen.getByRole("columnheader", {
        name: "people:table.columns.projects",
      }),
    ).toBeVisible();
    const rows = screen.getAllByRole("row").slice(1);
    const ada = rows.find((row) => within(row).queryByText("ada@example.com"));
    const boss = rows.find((row) =>
      within(row).queryByText("boss@example.com"),
    );
    const idle = rows.find((row) =>
      within(row).queryByText("idle@example.com"),
    );
    if (!ada || !boss || !idle) throw new Error("rows missing");

    expect(within(ada).getByText("Alpha")).toBeVisible();
    expect(within(ada).getByText("Beta")).toBeVisible();
    // The project role of each project, as a role label (the workspace role
    // select shows "member" as well).
    expect(within(ada).getAllByText("team:roles.member")).toHaveLength(2);
    expect(within(ada).getByText("team:roles.viewer")).toBeVisible();
    expect(within(boss).getByText("people:table.fullAccess")).toBeVisible();
    expect(within(boss).queryByText("people:table.noProjects")).toBeNull();
    expect(within(idle).getByText("people:table.noProjects")).toBeVisible();
  });

  it("folds projects beyond the third into a +N badge with the rest in its title", () => {
    renderPeople([
      person("ada", "member", {
        fullAccess: false,
        projects: [
          { id: "p1", name: "One", role: "member" },
          { id: "p2", name: "Two", role: "member" },
          { id: "p3", name: "Three", role: "member" },
          { id: "p4", name: "Four", role: "viewer" },
          { id: "p5", name: "Five", role: "viewer" },
        ],
      }),
    ]);

    expect(screen.queryByText("Four")).toBeNull();
    const more = screen.getByText("people:table.moreProjects:2");
    expect(more).toHaveAttribute(
      "title",
      "Four (team:roles.viewer), Five (team:roles.viewer)",
    );
  });
});

describe("WorkspacePeopleTable role select", () => {
  it("offers only the assignable roles", async () => {
    renderPeople([person("ada", "member")]);

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "team:membersTable.ariaChangeRole",
      }),
    );

    const options = (await screen.findAllByRole("option")).map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      "team:roles.viewer",
      "team:roles.member",
      "Qa-Lead",
    ]);
  });

  it("changes the role of the membership to the picked assignable role", async () => {
    renderPeople([person("ada", "member")]);

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "team:membersTable.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });

    await waitFor(() =>
      expect(updateMemberRole).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        memberId: "member-ada",
        role: "qa-lead",
      }),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:membersTable.roleUpdateSuccess",
      ),
    );
  });

  it("does not let a non-owner edit their own row", () => {
    renderPeople([person("current-user", "member")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });

  it("shows a badge for a member whose role the caller cannot assign", () => {
    renderPeople([person("root", "admin"), person("ada", "member")]);

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("team:roles.admin")).toBeVisible();
  });

  it("lets an owner change a member even when the role is not in the list", async () => {
    isOwner = true;
    renderPeople([person("root", "admin")]);

    const trigger = screen.getByRole("combobox", {
      name: "team:membersTable.ariaChangeRole",
    });
    // The current role stays visible as the selected value.
    expect(trigger).toHaveTextContent("team:roles.admin");

    fireEvent.click(trigger);
    const options = (await screen.findAllByRole("option")).map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      "team:roles.admin",
      "team:roles.viewer",
      "team:roles.member",
      "Qa-Lead",
    ]);
  });

  it("keeps the owner row a badge, even for an owner viewer", () => {
    isOwner = true;
    renderPeople([person("current-user", "owner")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.owner")).toBeVisible();
  });

  it("offers no select without the right to change roles", () => {
    canManageTeam.mockReturnValue(false);
    renderPeople([person("ada", "member")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });

  it("offers no select until the assignable roles are loaded", () => {
    assignableRoles = { data: undefined };
    renderPeople([person("ada", "member")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });

  it("shows an error with a retry when the list failed and there is no data", () => {
    assignableRoles = { data: undefined, isError: true };
    renderPeople([person("ada", "member")]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "team:membersTable.rolesLoadError",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "team:membersTable.rolesRetry" }),
    );
    expect(refetchAssignableRoles).toHaveBeenCalledTimes(1);
  });

  it("shows no load error to a user who cannot change roles", () => {
    canManageTeam.mockReturnValue(false);
    assignableRoles = { data: undefined, isError: true };
    renderPeople([person("ada", "member")]);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("applies a typeahead change on a row's closed select (reported with reason none)", async () => {
    renderPeople([person("ada", "member")]);
    const trigger = screen.getByRole("combobox", {
      name: "team:membersTable.ariaChangeRole",
    });

    // Focusing the trigger force-mounts the (hidden) items typeahead reads.
    act(() => trigger.focus());
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.keyDown(trigger, { key: "q" });

    await waitFor(() =>
      expect(updateMemberRole).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        memberId: "member-ada",
        role: "qa-lead",
      }),
    );
  });

  it("stays quiet when a background refetch failed but data exists", () => {
    assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES, isError: true };
    renderPeople([person("ada", "member")]);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("combobox")).toBeVisible();
  });

  it("labels a custom role by its capitalized name in the badge", () => {
    renderPeople([person("root", "release-manager")]);

    expect(screen.getByText("Release-Manager")).toBeVisible();
  });

  it("toasts a translated message when the role change is refused", async () => {
    updateMemberRole.mockRejectedValue(
      Object.assign(new Error("raw api text"), {
        code: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      }),
    );
    renderPeople([person("ada", "member")]);

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "team:membersTable.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "team:errors.roleExceedsYourPermissions",
      ),
    );
  });
});

describe("WorkspacePeopleTable removing a member", () => {
  it("removes by email after the confirmation", async () => {
    renderPeople([person("ada", "member")]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRemoveMember",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.removeMember",
      }),
    );
    expect(
      await screen.findByText("team:membersTable.removeDialogTitle"),
    ).toBeVisible();
    expect(deleteWorkspaceUser).not.toHaveBeenCalled();

    const confirm = screen
      .getAllByRole("button", { name: "team:membersTable.removeMember" })
      .at(-1);
    if (!confirm) throw new Error("no confirm button");
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(deleteWorkspaceUser).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        userId: "ada@example.com",
      }),
    );
  });

  it("offers no actions on the caller's own row or without the right to remove", () => {
    const { unmount } = renderPeople([person("current-user", "member")]);
    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaRemoveMember",
      }),
    ).toBeNull();
    unmount();

    canRemoveMembers.mockReturnValue(false);
    renderPeople([person("ada", "member")]);
    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaRemoveMember",
      }),
    ).toBeNull();
  });
});
