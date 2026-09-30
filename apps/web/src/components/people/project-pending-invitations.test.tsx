import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInvitationListItem } from "@/fetchers/project-invitation/get-project-invitations";
import { ProjectMemberError } from "@/lib/project-member-error";
import ProjectPendingInvitations from "./project-pending-invitations";

const success = vi.fn();
const error = vi.fn();
const warning = vi.fn();
const copyToClipboard = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
    warning: (msg: string) => warning(msg),
  },
}));

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/format", () => ({ formatDateMedium: () => "Sep 1, 2026" }));

let config: { hasSmtp: boolean } | undefined = { hasSmtp: true };
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

const resendInvitation = vi.fn();
const cancelInvitation = vi.fn();

vi.mock(
  "@/hooks/mutations/project-invitation/use-resend-project-invitation",
  () => ({
    default: () => ({ mutateAsync: resendInvitation, isPending: false }),
  }),
);
vi.mock(
  "@/hooks/mutations/project-invitation/use-cancel-project-invitation",
  () => ({
    default: () => ({ mutateAsync: cancelInvitation, isPending: false }),
  }),
);

const live: ProjectInvitationListItem = {
  id: "inv-live",
  email: "live@example.com",
  workspaceRole: "member",
  projectRole: "member",
  expiresAt: "2999-01-01T00:00:00.000Z",
  inviterName: "Ada",
  status: "live",
};
const expired: ProjectInvitationListItem = {
  ...live,
  id: "inv-old",
  email: "old@example.com",
  expiresAt: "2000-01-01T00:00:00.000Z",
  status: "expired",
};

const ROLES = [{ role: "viewer" }, { role: "member" }];
const onInviteAgain = vi.fn();
const onRetryRoles = vi.fn();

function renderList(
  props: Partial<React.ComponentProps<typeof ProjectPendingInvitations>> = {},
) {
  return render(
    <ProjectPendingInvitations
      projectId="project-1"
      workspaceId="workspace-1"
      invitations={[live]}
      canInvite
      canCancel
      projectRoles={ROLES}
      workspaceRoles={ROLES}
      rolesFailed={false}
      onRetryRoles={onRetryRoles}
      onInviteAgain={onInviteAgain}
      {...props}
    />,
  );
}

async function openMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "projectInvitations:list.ariaActions" }),
  );
  await screen.findByRole("menu");
}

const menuItem = (name: string) => screen.queryByRole("menuitem", { name });

beforeEach(() => {
  config = { hasSmtp: true };
  resendInvitation.mockResolvedValue({
    id: "inv-live",
    email: "live@example.com",
    emailAttempted: true,
    emailSent: true,
  });
  cancelInvitation.mockResolvedValue({
    id: "inv-live",
    email: "live@example.com",
    canceled: true,
  });
  copyToClipboard.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectPendingInvitations", () => {
  it("shows the email, both roles, the expiry and a pending badge for a live invitation", () => {
    renderList();

    expect(screen.getByText("live@example.com")).toBeVisible();
    expect(screen.getByText("team:invitations.pendingBadge")).toBeVisible();
    expect(screen.getByText("team:invitations.expires")).toBeVisible();
    expect(
      screen.getByText("projectInvitations:list.workspaceRole"),
    ).toBeVisible();
    expect(
      screen.getByText("projectInvitations:list.projectRole"),
    ).toBeVisible();
  });

  it("offers copy link, resend and cancel for a live invitation", async () => {
    renderList();
    await openMenu();

    expect(menuItem("team:invitations.copyLink")).toBeVisible();
    expect(menuItem("team:invitations.resend")).toBeVisible();
    expect(menuItem("team:membersTable.cancelInvitation")).toBeVisible();
    expect(menuItem("team:invitations.inviteAgain")).toBeNull();
  });

  it("copies the link of that invitation", async () => {
    renderList();
    await openMenu();

    fireEvent.click(menuItem("team:invitations.copyLink") as HTMLElement);

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(
        `${window.location.origin}/invitation/accept/inv-live`,
      ),
    );
  });

  it("renews instead of resending when no email is configured", async () => {
    config = { hasSmtp: false };
    resendInvitation.mockResolvedValue({
      id: "inv-live",
      email: "live@example.com",
      emailAttempted: false,
      emailSent: false,
    });
    renderList();
    await openMenu();

    expect(menuItem("team:invitations.resend")).toBeNull();
    fireEvent.click(menuItem("team:invitations.renew") as HTMLElement);

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.renewSuccess"),
    );
  });

  it("resends through the project route and reports a sent email", async () => {
    renderList();
    await openMenu();

    fireEvent.click(menuItem("team:invitations.resend") as HTMLElement);

    await waitFor(() =>
      expect(resendInvitation).toHaveBeenCalledWith({
        projectId: "project-1",
        invitationId: "inv-live",
      }),
    );
    expect(success).toHaveBeenCalledWith("team:invitations.resendSuccess");
  });

  it("warns when the relay refused the email of a resend", async () => {
    resendInvitation.mockResolvedValue({
      id: "inv-live",
      email: "live@example.com",
      emailAttempted: true,
      emailSent: false,
    });
    renderList();
    await openMenu();

    fireEvent.click(menuItem("team:invitations.resend") as HTMLElement);

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "projectInvitations:list.resendNotDelivered",
      ),
    );
    expect(success).not.toHaveBeenCalled();
  });

  it("maps a refused resend (rate limit) to its translated message", async () => {
    resendInvitation.mockRejectedValue(
      new ProjectMemberError("Too many invitations", {
        code: "RATE_LIMITED",
        status: 429,
        retryAfterSeconds: 30,
      }),
    );
    renderList();
    await openMenu();

    fireEvent.click(menuItem("team:invitations.resend") as HTMLElement);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "projectInvitations:errors.rateLimitedRetry",
      ),
    );
  });

  it("does not offer a resend for roles beyond the caller's reach", async () => {
    renderList({
      invitations: [{ ...live, projectRole: "qa-lead" }],
    });
    await openMenu();

    expect(menuItem("team:invitations.resend")).toBeNull();
    expect(menuItem("team:invitations.copyLink")).toBeVisible();
  });

  it("does not offer a resend when the workspace role is beyond reach either", async () => {
    renderList({
      invitations: [{ ...live, workspaceRole: "admin" }],
    });
    await openMenu();

    expect(menuItem("team:invitations.resend")).toBeNull();
  });

  it("marks an expired invitation and offers invite again and cancel, never a resend or a link", async () => {
    renderList({ invitations: [expired] });

    expect(screen.getByText("team:invitations.expiredBadge")).toBeVisible();
    expect(screen.getByText("team:invitations.expired")).toBeVisible();
    await openMenu();

    expect(menuItem("team:invitations.resend")).toBeNull();
    expect(menuItem("team:invitations.renew")).toBeNull();
    expect(menuItem("team:invitations.copyLink")).toBeNull();
    fireEvent.click(menuItem("team:invitations.inviteAgain") as HTMLElement);
    expect(onInviteAgain).toHaveBeenCalledWith(expired);
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it("offers only cancel for an expired invitation when the caller cannot invite", async () => {
    renderList({ invitations: [expired], canInvite: false });
    await openMenu();

    expect(menuItem("team:invitations.inviteAgain")).toBeNull();
    expect(menuItem("team:membersTable.cancelInvitation")).toBeVisible();
  });

  it("has no menu for an expired invitation without any right to act on it", () => {
    renderList({ invitations: [expired], canInvite: false, canCancel: false });

    expect(
      screen.queryByRole("button", {
        name: "projectInvitations:list.ariaActions",
      }),
    ).toBeNull();
  });

  it("keeps resend and copy but hides cancel without the right to cancel", async () => {
    renderList({ canCancel: false });
    await openMenu();

    expect(menuItem("team:invitations.resend")).toBeVisible();
    expect(menuItem("team:membersTable.cancelInvitation")).toBeNull();
  });

  it("keeps only the link for a live invitation when the caller cannot invite", async () => {
    renderList({ canInvite: false, canCancel: false });
    await openMenu();

    expect(menuItem("team:invitations.copyLink")).toBeVisible();
    expect(menuItem("team:invitations.resend")).toBeNull();
  });

  it("does not offer resend or invite again while the role lists are unknown, and lets the user retry", async () => {
    renderList({
      invitations: [live, expired],
      projectRoles: undefined,
      rolesFailed: true,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "projectInvitations:list.rolesRetry",
      }),
    );
    expect(onRetryRoles).toHaveBeenCalledTimes(1);

    const buttons = screen.getAllByRole("button", {
      name: "projectInvitations:list.ariaActions",
    });
    fireEvent.click(buttons[0]);
    await screen.findByRole("menu");
    expect(menuItem("team:invitations.resend")).toBeNull();
  });

  it("cancels after confirmation and says when the invitation still grants other projects", async () => {
    cancelInvitation.mockResolvedValue({
      id: "inv-live",
      email: "live@example.com",
      canceled: false,
    });
    renderList();
    await openMenu();

    fireEvent.click(
      menuItem("team:membersTable.cancelInvitation") as HTMLElement,
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(cancelInvitation).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    await waitFor(() =>
      expect(cancelInvitation).toHaveBeenCalledWith({
        projectId: "project-1",
        invitationId: "inv-live",
      }),
    );
    expect(success).toHaveBeenCalledWith(
      "projectInvitations:list.cancelSuccessOtherProjects",
    );
  });

  it("reports a cancel of an invitation that no longer exists", async () => {
    cancelInvitation.mockRejectedValue(
      new ProjectMemberError("", { code: "INVITATION_NOT_FOUND", status: 404 }),
    );
    renderList();
    await openMenu();

    fireEvent.click(
      menuItem("team:membersTable.cancelInvitation") as HTMLElement,
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("projectInvitations:errors.notFound"),
    );
  });

  it("shows an empty state without invitations", () => {
    renderList({ invitations: [] });

    expect(screen.getByText("projectInvitations:empty")).toBeVisible();
  });
});
