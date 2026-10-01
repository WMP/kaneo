import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";
import type { WorkspaceUserInvitation } from "@/types/workspace-user";
import WorkspacePendingInvitations from "./workspace-pending-invitations";

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

let invitationProjects: {
  invitationId: string;
  projects: { id: string; name: string; role: string }[];
}[] = [];
vi.mock(
  "@/hooks/queries/workspace/use-get-workspace-invitation-projects",
  () => ({
    default: () => ({ data: invitationProjects }),
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

const canInviteUsers = vi.fn(() => true);
const canCancelInvitations = vi.fn(() => true);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCancelInvitations: () => canCancelInvitations(),
    canInviteUsers: () => canInviteUsers(),
  }),
}));

beforeEach(() => {
  invitationProjects = [];
  cancelInvitation.mockResolvedValue({});
  canCancelInvitations.mockReturnValue(true);
  assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES };
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

const acceptedInvitation = {
  ...pendingInvitation,
  id: "invite-accepted",
  status: "accepted",
} as unknown as WorkspaceUserInvitation;

const renderRow = (invitation: WorkspaceUserInvitation) =>
  render(
    <WorkspacePendingInvitations
      workspaceId="workspace-1"
      invitations={[invitation]}
    />,
  );

const openMenu = () =>
  fireEvent.click(
    screen.getByRole("button", {
      name: "projectInvitations:list.ariaActions",
    }),
  );

describe("WorkspacePendingInvitations row menu", () => {
  it("copies the invitation link for that invitation when 'Copy link' is clicked", async () => {
    copyToClipboard.mockResolvedValue(true);
    renderRow(pendingInvitation);
    openMenu();

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

  it("opens the cancel confirmation dialog instead of cancelling directly", async () => {
    renderRow(pendingInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.cancelDialogTitle"),
    ).toBeVisible();
    expect(cancelInvitation).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("cancels after the confirmation and says so", async () => {
    renderRow(pendingInvitation);
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );
    await screen.findByText("team:membersTable.cancelDialogTitle");

    const confirm = screen
      .getAllByRole("button", { name: "team:membersTable.cancelInvitation" })
      .at(-1);
    if (!confirm) throw new Error("no confirm button");
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(cancelInvitation).toHaveBeenCalledWith({
        invitationId: "invite-1",
        workspaceId: "workspace-1",
      }),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:membersTable.cancelInviteSuccess",
      ),
    );
  });

  it("hides the row menu entirely when the user lacks canInvite", () => {
    canInviteUsers.mockReturnValue(false);
    renderRow(pendingInvitation);

    expect(
      screen.queryByRole("button", {
        name: "projectInvitations:list.ariaActions",
      }),
    ).toBeNull();
  });

  it("leaves accepted and cancelled invitations out", () => {
    render(
      <WorkspacePendingInvitations
        workspaceId="workspace-1"
        invitations={[
          acceptedInvitation,
          {
            ...pendingInvitation,
            id: "invite-cancelled",
            status: "canceled",
          } as unknown as WorkspaceUserInvitation,
        ]}
      />,
    );

    expect(screen.getByText("projectInvitations:empty")).toBeVisible();
  });

  it("names the projects a project invitation grants, with the project role in each", () => {
    invitationProjects = [
      {
        invitationId: "invite-1",
        projects: [
          { id: "p1", name: "Alpha", role: "member" },
          { id: "p2", name: "Beta", role: "qa-lead" },
        ],
      },
      {
        invitationId: "invite-other",
        projects: [{ id: "p3", name: "Elsewhere", role: "viewer" }],
      },
    ];
    renderRow(pendingInvitation);

    expect(screen.getByText("Alpha")).toBeVisible();
    expect(screen.getByText("team:roles.member")).toBeVisible();
    expect(screen.getByText("Beta")).toBeVisible();
    expect(screen.getByText("Qa-Lead")).toBeVisible();
    // Only what belongs to this invitation.
    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("shows no project for a plain workspace invitation", () => {
    invitationProjects = [
      {
        invitationId: "invite-other",
        projects: [{ id: "p3", name: "Elsewhere", role: "viewer" }],
      },
    ];
    renderRow(pendingInvitation);

    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("shows the workspace role of the invitation, and no project role", () => {
    renderRow(pendingInvitation);

    expect(
      screen.getByText("projectInvitations:list.workspaceRole"),
    ).toBeVisible();
    expect(
      screen.queryByText("projectInvitations:list.projectRole"),
    ).toBeNull();
  });
});

describe("WorkspacePendingInvitations expired invitations", () => {
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

  it("invites again first, then cancels the old invitation, with the same email and role and no resend", async () => {
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
    expect(calls).toEqual(["invite", "cancel"]);
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:inviteModal.success"),
    );
  });

  it("keeps the new invitation and still follows email delivery when cancelling the old one fails", async () => {
    cancelInvitation.mockRejectedValue(new Error("cancel failed"));
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "team:invitations.inviteAgainCancelError",
      ),
    );
    expect(inviteMember).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith("team:inviteModal.success");
  });

  it("never claims an email was sent without SMTP, even when the cancel fails", async () => {
    config = { hasSmtp: false };
    cancelInvitation.mockRejectedValue(new Error("cancel failed"));
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "team:invitations.inviteAgainCancelError",
      ),
    );
    expect(success).toHaveBeenCalledWith("team:inviteModal.successNoEmail");
    expect(success).not.toHaveBeenCalledWith("team:inviteModal.success");
  });

  it("offers no actions for an expired invitation without the right to cancel", () => {
    canCancelInvitations.mockReturnValue(false);
    renderRow(expiredInvitation);

    // Neither "Invite again" nor "Cancel" is available, so there is no menu.
    expect(
      screen.queryByRole("button", {
        name: "projectInvitations:list.ariaActions",
      }),
    ).toBeNull();
  });

  it("hides cancel, but keeps the link action, on a live invitation without the right to cancel", async () => {
    canCancelInvitations.mockReturnValue(false);
    renderRow(pendingInvitation);
    openMenu();

    expect(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.inviteAgain" }),
    ).toBeNull();
  });

  it("does not cancel the old invitation when creating the new one fails", async () => {
    inviteMember.mockRejectedValue(new Error("invite failed"));
    renderRow(expiredInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.inviteAgain",
      }),
    );

    await waitFor(() => expect(error).toHaveBeenCalledWith("invite failed"));
    expect(cancelInvitation).not.toHaveBeenCalled();
  });

  it("labels rows by their real state instead of always 'pending'", () => {
    const { unmount } = renderRow(pendingInvitation);
    expect(screen.getByText("team:invitations.pendingBadge")).toBeVisible();
    unmount();

    const expired = renderRow(expiredInvitation);
    expect(screen.getByText("team:invitations.expiredBadge")).toBeVisible();
    expect(screen.queryByText("team:invitations.pendingBadge")).toBeNull();
    expired.unmount();

    renderRow(rejectedInvitation);
    expect(screen.getByText("team:invitations.rejectedBadge")).toBeVisible();
    expect(screen.queryByText("team:invitations.pendingBadge")).toBeNull();
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

describe("WorkspacePendingInvitations resend", () => {
  it("resends with the invitation's own email and role when email is configured", async () => {
    renderRow(pendingInvitation);
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
    renderRow(pendingInvitation);
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
    renderRow(pendingInvitation);
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
    renderRow(pendingInvitation);
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
    renderRow(pendingInvitation);
    openMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team:invitations.resend" }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:invitations.resendError"),
    );
  });
});

describe("WorkspacePendingInvitations and the assignable roles list", () => {
  const adminInvitation = {
    ...pendingInvitation,
    id: "invite-admin",
    role: "admin",
  } as unknown as WorkspaceUserInvitation;
  const expiredAdminInvitation = {
    ...expiredInvitation,
    id: "invite-admin-old",
    role: "admin",
  } as unknown as WorkspaceUserInvitation;

  it("hides resend and renew when the caller could not grant the invitation's role", async () => {
    renderRow(adminInvitation);
    openMenu();

    expect(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.resend" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.renew" }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    ).toBeVisible();
  });

  it("hides 'Invite again' when the caller could not grant the invitation's role", async () => {
    renderRow(expiredAdminInvitation);
    openMenu();

    await screen.findByRole("menuitem", {
      name: "team:membersTable.cancelInvitation",
    });
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.inviteAgain" }),
    ).toBeNull();
  });

  it("hides the role-based invitation actions until the assignable roles are loaded", async () => {
    assignableRoles = { data: undefined };
    renderRow(pendingInvitation);
    openMenu();

    await screen.findByRole("menuitem", { name: "team:invitations.copyLink" });
    expect(
      screen.queryByRole("menuitem", { name: "team:invitations.resend" }),
    ).toBeNull();
  });

  it("shows an error with a retry to a user who can invite when the list failed and there is no data", () => {
    assignableRoles = { data: undefined, isError: true };
    renderRow(pendingInvitation);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "team:membersTable.rolesLoadError",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "team:membersTable.rolesRetry" }),
    );
    expect(refetchAssignableRoles).toHaveBeenCalledTimes(1);
  });

  it("shows no load error to a user who cannot invite", () => {
    canInviteUsers.mockReturnValue(false);
    assignableRoles = { data: undefined, isError: true };
    renderRow(pendingInvitation);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays quiet when a background refetch failed but data exists", () => {
    assignableRoles = { data: DEFAULT_ASSIGNABLE_ROLES, isError: true };
    renderRow(pendingInvitation);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
