import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import MembersTable from "./members-table";

const copyToClipboard = vi.fn();
const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "Sep 1, 2026",
}));

const cancelInvitation = vi.fn();

vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: cancelInvitation, isPending: false }),
}));

const inviteMember = vi.fn();
let config: { hasSmtp: boolean } | undefined = { hasSmtp: true };

vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync: inviteMember, isPending: false }),
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const updateMemberRole = vi.fn();

vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: updateMemberRole }),
  }),
);

type AssignableRolesState = {
  data: { role: string; isDefault: boolean }[] | undefined;
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
  default: () => assignableRoles,
}));

const canInviteUsers = vi.fn(() => true);
let isOwner = false;

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => true,
    canRemoveMembers: () => true,
    canInviteUsers: () => canInviteUsers(),
    isOwner,
  }),
}));

vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
  cancelInvitation.mockResolvedValue({});
  isOwner = false;
  assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES };
  updateMemberRole.mockResolvedValue({});
  canInviteUsers.mockReturnValue(true);
  config = { hasSmtp: true };
  inviteMember.mockResolvedValue({ id: "invite-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pendingInvitation = {
  id: "invite-1",
  email: "invitee@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2999-01-01T00:00:00.000Z",
} as unknown as WorkspaceUserInvitation;

const expiredInvitation = {
  ...pendingInvitation,
  id: "invite-old",
  role: "qa-lead",
  expiresAt: "2000-01-01T00:00:00.000Z",
} as unknown as WorkspaceUserInvitation;

const rejectedInvitation = {
  ...pendingInvitation,
  id: "invite-rejected",
  status: "rejected",
} as unknown as WorkspaceUserInvitation;

describe("MembersTable pending invitation row menu", () => {
  it("copies the invitation link for that invitation when 'Copy link' is clicked", async () => {
    copyToClipboard.mockResolvedValue(true);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    );

    expect(copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/invitation/accept/invite-1`,
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.linkCopied"),
    );
  });

  it("still opens the cancel confirmation dialog instead of cancelling directly", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.cancelDialogTitle"),
    ).toBeVisible();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("hides the row menu entirely when the user lacks canInvite", () => {
    canInviteUsers.mockReturnValue(false);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    ).toBeNull();
  });
});

describe("MembersTable expired invitations", () => {
  const renderRow = (invitation: WorkspaceUserInvitation) =>
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[invitation]}
        users={[] as WorkspaceUser[]}
      />,
    );
  const openMenu = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

  it("offers only 'Invite again' and cancel for an expired invitation", async () => {
    renderRow(expiredInvitation);
    openMenu();

    expect(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.resend" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.renew" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.copyLink" }),
    ).toBeNull();
    expect(screen.getByText("team:invitations.expired")).toBeVisible();
  });

  it("cancels the old invitation, then invites again with the same email and role without resend", async () => {
    const calls: string[] = [];
    cancelInvitation.mockImplementation(async () => {
      calls.push("cancel");
    });
    inviteMember.mockImplementation(async () => {
      calls.push("invite");
      return { id: "invite-new" };
    });
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() => expect(inviteMember).toHaveBeenCalled());
    expect(cancelInvitation).toHaveBeenCalledWith({
      invitationId: "invite-old",
      workspaceId: "workspace-1",
    });
    expect(inviteMember).toHaveBeenCalledWith({
      email: "invitee@example.com",
      role: "qa-lead",
      workspaceId: "workspace-1",
    });
    expect(calls).toEqual(["cancel", "invite"]);
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:inviteModal.success"),
    );
  });

  it("does not invite when cancelling the old invitation fails", async () => {
    cancelInvitation.mockRejectedValue(new Error("cancel failed"));
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() => expect(error).toHaveBeenCalledWith("cancel failed"));
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it("treats a non-pending row like an expired one", async () => {
    renderRow(rejectedInvitation);
    openMenu();

    expect(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.resend" }),
    ).toBeNull();
  });

  it("uses neutral copy after inviting again while the config is unknown", async () => {
    config = undefined;
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:inviteModal.successUnknownEmail",
      ),
    );
  });
});

describe("MembersTable resend invitation", () => {
  const openMenu = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

  const renderTable = () =>
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

  it("resends with the invitation's own email and role when email is configured", async () => {
    renderTable();
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.resend" }),
    );

    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith({
        email: "invitee@example.com",
        role: "member",
        workspaceId: "workspace-1",
        resend: true,
      }),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.resendSuccess"),
    );
  });

  it("offers a renew action that says no email was sent when SMTP is off", async () => {
    config = { hasSmtp: false };
    renderTable();
    openMenu();

    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.resend" }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.renew" }),
    );

    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith(
        expect.objectContaining({ resend: true }),
      ),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.renewSuccess"),
    );
  });

  it("does not promise an email while the config is unknown", async () => {
    config = undefined;
    renderTable();
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.renew" }),
    );

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:invitations.renewSuccessUnknownEmail",
      ),
    );
    expect(success).not.toHaveBeenCalledWith("team:invitations.renewSuccess");
    expect(success).not.toHaveBeenCalledWith("team:invitations.resendSuccess");
  });

  it("shows a translated message for a known API error code", async () => {
    inviteMember.mockRejectedValue(
      new WorkspaceMemberError("raw api text", {
        code: "INVITATION_LIMIT_REACHED",
      }),
    );
    renderTable();
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.resend" }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:errors.invitationLimitReached"),
    );
    expect(success).not.toHaveBeenCalled();
  });

  it("falls back to the resend error copy when the API sent no message", async () => {
    inviteMember.mockRejectedValue(new WorkspaceMemberError(""));
    renderTable();
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.resend" }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:invitations.resendError"),
    );
  });
});

describe("MembersTable role select", () => {
  const makeUser = (
    id: string,
    role: string,
    name: string = id,
  ): WorkspaceUser =>
    ({
      id: `member-${id}`,
      userId: id,
      role,
      createdAt: "2026-01-01T00:00:00.000Z",
      user: { name, email: `${id}@example.com`, image: null },
    }) as unknown as WorkspaceUser;

  const renderUsers = (users: WorkspaceUser[]) =>
    render(
      <MembersTable workspaceId="workspace-1" invitations={[]} users={users} />,
    );

  it("offers only the assignable roles", async () => {
    renderUsers([makeUser("ada", "member")]);

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
      "Qa-lead",
    ]);
  });

  it("changes the role to the picked assignable role", async () => {
    renderUsers([makeUser("ada", "member")]);

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "team:membersTable.ariaChangeRole",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });

    await waitFor(() =>
      expect(updateMemberRole).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        memberId: "member-ada",
        role: "qa-lead",
      }),
    );
  });

  it("does not let a non-owner edit their own row", () => {
    renderUsers([makeUser("current-user", "member")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });

  it("shows a badge for a member whose role the caller cannot assign", () => {
    renderUsers([makeUser("root", "admin"), makeUser("ada", "member")]);

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("team:roles.admin")).toBeVisible();
  });

  it("lets an owner change a member even when the role is not in the list", async () => {
    isOwner = true;
    assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES };
    renderUsers([makeUser("root", "admin")]);

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
      "Qa-lead",
    ]);
  });

  it("keeps the owner row a badge, even for an owner viewer", () => {
    isOwner = true;
    renderUsers([makeUser("current-user", "owner")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.owner")).toBeVisible();
  });

  it("offers no select until the assignable roles are loaded", () => {
    assignableRoles = { data: undefined };
    renderUsers([makeUser("ada", "member")]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });
});
