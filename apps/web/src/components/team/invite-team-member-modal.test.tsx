import {
  act,
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
  isLoading: boolean;
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
  isLoading: false,
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

let activeWorkspace: { id: string } | undefined = { id: "workspace-1" };

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: activeWorkspace }),
}));

const refetchRoles = vi.fn();

vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => ({ ...rolesState, refetch: refetchRoles }),
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
  activeWorkspace = { id: "workspace-1" };
  rolesState = { data: DEFAULT_ROLES, isLoading: false, isError: false };
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

  it("claims neither an email nor its absence while the config is unknown", async () => {
    config = undefined;
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    expect(screen.queryByText("team:inviteModal.noSmtpNotice")).toBeNull();

    await submitEmail("a@example.com");

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:inviteModal.successUnknownEmail",
      ),
    );
    expect(success).not.toHaveBeenCalledWith("team:inviteModal.success");
    expect(success).not.toHaveBeenCalledWith("team:inviteModal.successNoEmail");
    expect(
      await screen.findByText(
        "team:inviteModal.shareLinkDescriptionUnknownEmail",
      ),
    ).toBeVisible();
  });

  it("disables submit and sends only one request while the invitation is being created", async () => {
    let resolveInvite: (value: { id: string }) => void = () => {};
    mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveInvite = resolve;
      }),
    );
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    await submitEmail("a@example.com");

    const busyButton = await screen.findByRole("button", {
      name: "team:inviteModal.sending",
    });
    expect(busyButton).toBeDisabled();
    // A disabled submit button also blocks the form's implicit submission
    // (Enter in the email field), so clicking it again must do nothing.
    fireEvent.click(busyButton);
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    resolveInvite({ id: "invite-9" });
    expect(await screen.findByText("link:invite-9")).toBeVisible();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("re-enables submit after a failed request", async () => {
    mutateAsync.mockRejectedValue(new Error("boom"));
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);

    await submitEmail("a@example.com");

    await waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
    expect(
      screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
    ).toBeEnabled();
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
        "Qa-Lead",
      ]);
      expect(options).not.toContain("team:roles.owner");
    });

    it("sends the role the user picked", async () => {
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      fireEvent.click(roleTrigger());
      const option = await screen.findByRole("option", { name: "Qa-Lead" });
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

    it("requires an explicit pick when member is not assignable, instead of falling back to the first role", async () => {
      rolesState = {
        data: [
          { role: "admin", isDefault: true },
          { role: "qa-lead", isDefault: false },
        ],
        isLoading: false,
        isError: false,
      };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(roleTrigger()).toHaveTextContent(
        "team:inviteModal.rolePlaceholder",
      );
      expect(roleTrigger()).not.toHaveTextContent("team:roles.admin");
      expect(
        screen.getByText("team:inviteModal.rolePickRequired"),
      ).toBeVisible();
      expect(submitButton()).toBeDisabled();

      fireEvent.click(roleTrigger());
      const option = await screen.findByRole("option", { name: "Qa-Lead" });
      fireEvent.pointerDown(option);
      fireEvent.click(option, { detail: 1 });
      await waitFor(() => expect(submitButton()).toBeEnabled());

      await submitEmail("a@example.com");
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ role: "qa-lead" }),
        ),
      );
    });

    it("drops the implicit member default when member leaves the list", async () => {
      const { rerender } = render(
        <InviteTeamMemberModal open onClose={vi.fn()} />,
      );
      expect(roleTrigger()).toHaveTextContent("team:roles.member");

      rolesState = {
        data: DEFAULT_ROLES.filter((r) => r.role !== "member"),
        isLoading: false,
        isError: false,
      };
      rerender(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(roleTrigger()).toHaveTextContent(
        "team:inviteModal.rolePlaceholder",
      );
      expect(roleTrigger()).not.toHaveTextContent("team:roles.viewer");
      expect(submitButton()).toBeDisabled();
    });

    it("applies a typeahead change on the closed trigger (reported with reason none)", async () => {
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      // Focusing the trigger force-mounts the (hidden) items typeahead reads.
      act(() => roleTrigger().focus());
      await new Promise((resolve) => setTimeout(resolve, 20));
      fireEvent.keyDown(roleTrigger(), { key: "q" });

      await waitFor(() => expect(roleTrigger()).toHaveTextContent("Qa-Lead"));
      await submitEmail("a@example.com");
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ role: "qa-lead" }),
        ),
      );
    });

    it("disables submit and sends nothing while the roles load", async () => {
      rolesState = { data: undefined, isLoading: true, isError: false };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.getByText("team:inviteModal.rolesLoading")).toBeVisible();
      expect(submitButton()).toBeDisabled();
    });

    it("shows a message and disables submit when no role is assignable", async () => {
      rolesState = { data: [], isLoading: false, isError: false };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(
        screen.getByText("team:inviteModal.noAssignableRoles"),
      ).toBeVisible();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(submitButton()).toBeDisabled();
    });

    it("shows an error and disables submit when the roles fail to load", async () => {
      rolesState = { data: undefined, isLoading: false, isError: true };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "team:inviteModal.rolesError",
      );
      expect(submitButton()).toBeDisabled();
    });

    it("keeps the picker and submit usable when a background refetch fails but data exists", async () => {
      rolesState = { data: DEFAULT_ROLES, isLoading: false, isError: true };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(roleTrigger()).toHaveTextContent("team:roles.member");
      expect(screen.queryByText("team:inviteModal.rolesError")).toBeNull();

      await submitEmail("a@example.com");

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ role: "member" }),
        ),
      );
    });

    it("shows neither a spinner nor a picker without a workspace, and disables submit", () => {
      activeWorkspace = undefined;
      rolesState = { data: undefined, isLoading: false, isError: false };
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.queryByText("team:inviteModal.rolesLoading")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(submitButton()).toBeDisabled();
    });

    it("empties the selection and blocks submit when the picked role disappears", async () => {
      const { rerender } = render(
        <InviteTeamMemberModal open onClose={vi.fn()} />,
      );
      fireEvent.click(roleTrigger());
      const option = await screen.findByRole("option", { name: "Qa-Lead" });
      fireEvent.pointerDown(option);
      fireEvent.click(option, { detail: 1 });
      await waitFor(() => expect(roleTrigger()).toHaveTextContent("Qa-Lead"));

      rolesState = {
        data: DEFAULT_ROLES.filter((r) => r.role !== "qa-lead"),
        isLoading: false,
        isError: false,
      };
      rerender(<InviteTeamMemberModal open onClose={vi.fn()} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "team:inviteModal.roleUnavailable",
      );
      // The vanished pick stays visible as the invalid selection; nothing else
      // is selected in its place.
      expect(roleTrigger()).toHaveTextContent("Qa-Lead");
      expect(roleTrigger()).not.toHaveTextContent("team:roles.member");
      expect(submitButton()).toBeDisabled();

      // Choosing again clears the message and re-enables submit.
      fireEvent.click(roleTrigger());
      const viewer = await screen.findByRole("option", {
        name: "team:roles.viewer",
      });
      fireEvent.pointerDown(viewer);
      fireEvent.click(viewer, { detail: 1 });
      await waitFor(() => expect(submitButton()).toBeEnabled());
      expect(screen.queryByText("team:inviteModal.roleUnavailable")).toBeNull();

      await submitEmail("a@example.com");
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ role: "viewer" }),
        ),
      );
    });

    it("refetches the assignable roles each time the modal opens, not on mount while closed", () => {
      const { rerender } = render(
        <InviteTeamMemberModal open={false} onClose={vi.fn()} />,
      );
      expect(refetchRoles).not.toHaveBeenCalled();

      rerender(<InviteTeamMemberModal open onClose={vi.fn()} />);
      expect(refetchRoles).toHaveBeenCalledTimes(1);
      // It joins a request already in flight instead of restarting it.
      expect(refetchRoles).toHaveBeenCalledWith({ cancelRefetch: false });

      rerender(<InviteTeamMemberModal open={false} onClose={vi.fn()} />);
      rerender(<InviteTeamMemberModal open onClose={vi.fn()} />);
      expect(refetchRoles).toHaveBeenCalledTimes(2);
    });
  });
});
