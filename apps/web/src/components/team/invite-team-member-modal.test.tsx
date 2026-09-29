import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";
import InviteTeamMemberModal from "./invite-team-member-modal";

const mutateAsync = vi.fn();
const success = vi.fn();
const error = vi.fn();
let config: { hasSmtp: boolean } | undefined = { hasSmtp: true };

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    refetchQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync }),
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canInviteUsers: () => true }),
}));

vi.mock("./invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <div>link:{invitationId}</div>
  ),
}));

beforeEach(() => {
  config = { hasSmtp: true };
  mutateAsync.mockResolvedValue({ id: "invite-9" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submitEmail = async (value: string) => {
  const input = await screen.findByPlaceholderText(
    "team:inviteModal.emailPlaceholder",
  );
  fireEvent.change(input, { target: { value } });
  fireEvent.click(
    screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
  );
};

describe("InviteTeamMemberModal", () => {
  it("rejects an invalid email with a translated message and sends nothing", async () => {
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    await submitEmail("not-an-email");

    expect(
      await screen.findByText("team:inviteModal.invalidEmail"),
    ).toBeVisible();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("trims and lowercases the email and sends the default member role", async () => {
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    await submitEmail("  Colleague@Example.COM ");

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        email: "colleague@example.com",
        workspaceId: "workspace-1",
        role: "member",
      }),
    );
  });

  it("shows no SMTP notice and claims the email was sent when SMTP is configured", async () => {
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    expect(screen.queryByText("team:inviteModal.noSmtpNotice")).toBeNull();

    await submitEmail("a@example.com");

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:inviteModal.success"),
    );
    expect(
      await screen.findByText("team:inviteModal.shareLinkDescription"),
    ).toBeVisible();
  });

  it("warns before submit and never claims an email when SMTP is off", async () => {
    config = { hasSmtp: false };
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    expect(
      await screen.findByText("team:inviteModal.noSmtpNotice"),
    ).toBeVisible();

    await submitEmail("a@example.com");

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:inviteModal.successNoEmail"),
    );
    expect(success).not.toHaveBeenCalledWith("team:inviteModal.success");
    expect(
      await screen.findByText("team:inviteModal.shareLinkDescriptionNoEmail"),
    ).toBeVisible();
  });

  it("shows a translated message for a known API error code", async () => {
    mutateAsync.mockRejectedValue(
      new WorkspaceMemberError("raw api text", {
        code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
      }),
    );
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    await submitEmail("a@example.com");

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:errors.alreadyMember"),
    );
  });
});
