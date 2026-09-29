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

type RolesState = {
  data: { role: string; isDefault: boolean }[] | undefined;
  isPending: boolean;
  isError: boolean;
};
const DEFAULT_ROLES = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "admin", isDefault: true },
  { role: "qa-lead", isDefault: false },
];
let rolesState: RolesState = {
  data: DEFAULT_ROLES,
  isPending: false,
  isError: false,
};

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

vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => rolesState,
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
  rolesState = { data: DEFAULT_ROLES, isPending: false, isError: false };
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

  describe("role picker", () => {
    const roleTrigger = () =>
      screen.getByRole("combobox", { name: "team:inviteModal.roleLabel" });
    const submitButton = () =>
      screen.getByRole("button", { name: "team:inviteModal.sendInvitation" });

    it("labels the role select and selects member by default", async () => {
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(roleTrigger()).toHaveTextContent("team:roles.member");
    });

    it("lists the assignable roles with translated defaults and capitalized custom names", async () => {
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      fireEvent.click(roleTrigger());

      const options = (await screen.findAllByRole("option")).map(
        (option) => option.textContent,
      );
      expect(options).toEqual([
        "team:roles.viewer",
        "team:roles.member",
        "team:roles.admin",
        "Qa-lead",
      ]);
      expect(options).not.toContain("team:roles.owner");
    });

    it("sends the role the user picked", async () => {
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      fireEvent.click(roleTrigger());
      const option = await screen.findByRole("option", { name: "Qa-lead" });
      fireEvent.pointerDown(option);
      fireEvent.click(option, { detail: 1 });
      await submitEmail("a@example.com");

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          email: "a@example.com",
          workspaceId: "workspace-1",
          role: "qa-lead",
        }),
      );
    });

    it("defaults to the first returned role when member is not assignable", async () => {
      rolesState = {
        data: [
          { role: "viewer", isDefault: true },
          { role: "qa-lead", isDefault: false },
        ],
        isPending: false,
        isError: false,
      };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(roleTrigger()).toHaveTextContent("team:roles.viewer");

      await submitEmail("a@example.com");

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ role: "viewer" }),
        ),
      );
    });

    it("disables submit and sends nothing while the roles load", async () => {
      rolesState = { data: undefined, isPending: true, isError: false };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.getByText("team:inviteModal.rolesLoading")).toBeVisible();
      expect(submitButton()).toBeDisabled();
    });

    it("shows a message and disables submit when no role is assignable", async () => {
      rolesState = { data: [], isPending: false, isError: false };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(
        screen.getByText("team:inviteModal.noAssignableRoles"),
      ).toBeVisible();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(submitButton()).toBeDisabled();
    });

    it("shows an error and disables submit when the roles fail to load", async () => {
      rolesState = { data: undefined, isPending: false, isError: true };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "team:inviteModal.rolesError",
      );
      expect(submitButton()).toBeDisabled();
    });
  });
});
