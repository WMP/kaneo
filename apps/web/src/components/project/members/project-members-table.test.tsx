import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectMember } from "@/fetchers/project-member/get-project-members";
import { ProjectMemberError } from "@/lib/project-member-error";
import ProjectMembersTable from "./project-members-table";

const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const updateMember = vi.fn();
const removeMember = vi.fn();

vi.mock("@/hooks/mutations/project-member/use-update-project-member", () => ({
  default: () => ({ mutateAsync: updateMember }),
}));

vi.mock("@/hooks/mutations/project-member/use-remove-project-member", () => ({
  default: () => ({ mutateAsync: removeMember, isPending: false }),
}));

// The real hook's order (request, afterLeft, then invalidation) has its own
// test; here `leave` runs the request and then afterLeft.
const leaveRequest = vi.fn();
vi.mock("@/hooks/mutations/project-member/use-leave-project", () => ({
  default: () => ({
    leave: async (
      variables: { projectId: string; userId: string },
      afterLeft: () => void | Promise<void>,
    ) => {
      await leaveRequest(variables);
      await afterLeft();
    },
    isPending: false,
  }),
}));

const member = (overrides: Partial<ProjectMember>): ProjectMember => ({
  userId: "user",
  name: "User",
  email: "user@example.com",
  image: null,
  role: "member",
  source: "project",
  active: true,
  ...overrides,
});

const owner = member({
  userId: "u-owner",
  name: "Olga Owner",
  email: "olga@example.com",
  role: "owner",
  source: "full-access",
});
const alice = member({
  userId: "u-alice",
  name: "Alice",
  email: "alice@example.com",
  role: "member",
});
const bob = member({
  userId: "u-bob",
  name: "Bob",
  email: "bob@example.com",
  role: "viewer",
});
const ghost = member({
  userId: "u-ghost",
  name: "Gina Ghost",
  email: "gina@example.com",
  role: "removed-role",
  active: false,
});
const me = member({
  userId: "me",
  name: "Me Myself",
  email: "me@example.com",
  role: "member",
});

const ROLES = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "qa-lead", isDefault: false },
];

const onLeft = vi.fn();
const onRetryRoles = vi.fn();

function renderTable(
  props: Partial<React.ComponentProps<typeof ProjectMembersTable>> = {},
) {
  return render(
    <ProjectMembersTable
      projectId="project-1"
      workspaceId="workspace-1"
      members={[owner, alice, bob, ghost, me]}
      currentUserId="me"
      canManage
      assignableRoles={ROLES}
      assignableRolesFailed={false}
      onRetryRoles={onRetryRoles}
      onLeft={onLeft}
      {...props}
    />,
  );
}

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

beforeEach(() => {
  updateMember.mockResolvedValue({});
  removeMember.mockResolvedValue({});
  leaveRequest.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectMembersTable", () => {
  it("badges a full-access row and offers neither a role select nor removal for it", () => {
    renderTable();

    const row = rowOf("Olga Owner");
    expect(
      within(row).getByText("projectMembers:table.fullAccess"),
    ).toBeVisible();
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("lists full-access rows first and inactive memberships last", () => {
    renderTable();

    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);
    expect(names.map((text) => text?.replace(/^[A-Z]{2}/, ""))).toEqual([
      "Olga Ownerolga@example.com",
      "Alicealice@example.com",
      "Bobbob@example.com",
      "Me Myself(projectMembers:table.you)me@example.com",
      "Gina Ghostgina@example.com",
    ]);
  });

  it("changes a role with the project route and confirms it", async () => {
    renderTable();

    fireEvent.click(
      within(rowOf("Alice")).getByRole("combobox", {
        name: "projectMembers:table.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });

    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-alice",
        role: "qa-lead",
      }),
    );
    expect(success).toHaveBeenCalledWith(
      "projectMembers:table.roleUpdateSuccess",
    );
  });

  it("offers only the project assignable roles", async () => {
    renderTable();

    fireEvent.click(
      within(rowOf("Alice")).getByRole("combobox", {
        name: "projectMembers:table.ariaChangeRole",
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

  it("maps a refused role change to its translated message", async () => {
    updateMember.mockRejectedValue(
      new ProjectMemberError("x", {
        code: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
        status: 403,
      }),
    );
    renderTable();

    fireEvent.click(
      within(rowOf("Bob")).getByRole("combobox", {
        name: "projectMembers:table.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "projectMembers:errors.roleExceedsYourPermissions",
      ),
    );
    expect(success).not.toHaveBeenCalled();
  });

  it("never offers a role select or removal for one's own row, only leaving", async () => {
    renderTable();

    const row = rowOf("Me Myself");
    expect(within(row).queryByRole("combobox")).toBeNull();
    fireEvent.click(
      within(row).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: "projectMembers:table.leaveProject",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", {
        name: "projectMembers:table.removeMember",
      }),
    ).toBeNull();
  });

  it("marks an inactive membership and lets it be re-assigned or removed", async () => {
    renderTable();

    const row = rowOf("Gina Ghost");
    expect(
      within(row).getByText("projectMembers:table.inactive"),
    ).toBeVisible();
    // Its role grants nothing, yet it can be replaced by an assignable one.
    fireEvent.click(
      within(row).getByRole("combobox", {
        name: "projectMembers:table.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });
    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-ghost",
        role: "qa-lead",
      }),
    );
    expect(
      within(row).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    ).toBeVisible();
  });

  it("removes a member after confirmation", async () => {
    renderTable();

    fireEvent.click(
      within(rowOf("Bob")).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "projectMembers:table.removeMember",
      }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(removeMember).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "projectMembers:table.removeMember",
      }),
    );

    await waitFor(() =>
      expect(removeMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-bob",
      }),
    );
    expect(success).toHaveBeenCalledWith("projectMembers:removeDialog.success");
  });

  it("reports a membership that changed meanwhile as a retry hint", async () => {
    removeMember.mockRejectedValue(
      new ProjectMemberError("The project membership changed, please retry", {
        code: "PROJECT_MEMBERSHIP_CHANGED",
        status: 409,
      }),
    );
    renderTable();

    fireEvent.click(
      within(rowOf("Bob")).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "projectMembers:table.removeMember",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "projectMembers:table.removeMember",
      }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "projectMembers:errors.membershipChanged",
      ),
    );
  });

  it("leaves the project with one's own id and reports it", async () => {
    renderTable();

    fireEvent.click(
      within(rowOf("Me Myself")).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "projectMembers:table.leaveProject",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "projectMembers:table.leaveProject",
      }),
    );

    await waitFor(() =>
      expect(leaveRequest).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "me",
      }),
    );
    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
    expect(removeMember).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("projectMembers:leaveDialog.success");
  });

  it("does not navigate away when leaving fails", async () => {
    leaveRequest.mockRejectedValue(new ProjectMemberError("", { status: 500 }));
    renderTable();

    fireEvent.click(
      within(rowOf("Me Myself")).getByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "projectMembers:table.leaveProject",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "projectMembers:table.leaveProject",
      }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("projectMembers:leaveDialog.error"),
    );
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("shows role badges only, and no removal, without the right to manage", () => {
    renderTable({ canManage: false });

    expect(screen.queryByRole("combobox")).toBeNull();
    // Only the caller's own row keeps an action menu (leave).
    expect(
      screen.getAllByRole("button", {
        name: "projectMembers:table.ariaActions",
      }),
    ).toHaveLength(1);
    expect(within(rowOf("Alice")).getByText("team:roles.member")).toBeVisible();
  });

  it("offers no role select before the assignable roles are known and lets the user retry a failed load", () => {
    renderTable({ assignableRoles: undefined, assignableRolesFailed: true });

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "projectMembers:table.rolesRetry" }),
    );
    expect(onRetryRoles).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state without members", () => {
    renderTable({ members: [] });

    expect(screen.getByText("projectMembers:table.emptyTitle")).toBeVisible();
  });
});
