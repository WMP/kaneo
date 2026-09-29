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

vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: vi.fn() }),
  }),
);

vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));

const canInviteUsers = vi.fn(() => true);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => true,
    canRemoveMembers: () => true,
    canInviteUsers: () => canInviteUsers(),
  }),
}));

vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
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
  expiresAt: "2026-09-01T00:00:00.000Z",
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
      expect(success).toHaveBeenCalledWith("team:invitations.renewSuccess"),
    );
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
