import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemberError } from "@/lib/project-member-error";
import InviteToProjectDialog from "./invite-to-project-dialog";

const success = vi.fn();
const error = vi.fn();
const createInvitation = vi.fn();
const onClose = vi.fn();
const onAddExistingMember = vi.fn();
let config: { hasSmtp: boolean } | undefined = { hasSmtp: true };

type Roles = { role: string; isDefault: boolean }[] | undefined;
type RolesState = { data: Roles; isLoading: boolean; isError: boolean };

const WORKSPACE_ROLES: Roles = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "admin", isDefault: true },
];
const PROJECT_ROLES: Roles = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "qa-lead", isDefault: false },
];
let workspaceRoles: RolesState;
let projectRoles: RolesState;

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

vi.mock(
  "@/hooks/mutations/project-invitation/use-create-project-invitation",
  () => ({ default: () => ({ mutateAsync: createInvitation }) }),
);

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => ({ ...workspaceRoles, refetch: vi.fn() }),
}));

vi.mock(
  "@/hooks/queries/project-member/use-get-project-assignable-roles",
  () => ({ default: () => ({ ...projectRoles, refetch: vi.fn() }) }),
);

vi.mock("@/components/team/invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <div>link:{invitationId}</div>
  ),
}));

const created = (overrides: Record<string, unknown> = {}) => ({
  created: true,
  invitation: {
    id: "inv-1",
    email: "new@example.com",
    workspaceRole: "member",
    projectRole: "member",
    projectId: "project-1",
    expiresAt: "2999-01-01T00:00:00.000Z",
    emailAttempted: true,
    emailSent: true,
    ...overrides,
  },
});

function renderDialog(
  props: Partial<React.ComponentProps<typeof InviteToProjectDialog>> = {},
) {
  return render(
    <InviteToProjectDialog
      open
      onClose={onClose}
      projectId="project-1"
      workspaceId="workspace-1"
      {...props}
    />,
  );
}

async function submitEmail(value: string) {
  fireEvent.change(
    await screen.findByPlaceholderText(
      "projectInvitations:invite.emailPlaceholder",
    ),
    { target: { value } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "projectInvitations:invite.submit" }),
  );
}

async function pick(label: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option, { detail: 1 });
}

beforeEach(() => {
  config = { hasSmtp: true };
  workspaceRoles = { data: WORKSPACE_ROLES, isLoading: false, isError: false };
  projectRoles = { data: PROJECT_ROLES, isLoading: false, isError: false };
  createInvitation.mockResolvedValue(created());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InviteToProjectDialog", () => {
  it("rejects an invalid email with a translated message and sends nothing", async () => {
    renderDialog();

    await submitEmail("not-an-email");

    expect(
      await screen.findByText("projectInvitations:invite.invalidEmail"),
    ).toBeVisible();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("offers a workspace role and a project role and sends both, with the email lower-cased", async () => {
    renderDialog();

    expect(
      screen.getByRole("combobox", {
        name: "projectInvitations:invite.workspaceRoleLabel",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", {
        name: "projectInvitations:invite.projectRoleLabel",
      }),
    ).toBeVisible();

    await pick(
      "projectInvitations:invite.workspaceRoleLabel",
      "team:roles.admin",
    );
    await pick("projectInvitations:invite.projectRoleLabel", "Qa-Lead");
    await submitEmail("  New@Example.com ");

    await waitFor(() =>
      expect(createInvitation).toHaveBeenCalledWith({
        projectId: "project-1",
        email: "new@example.com",
        workspaceRole: "admin",
        projectRole: "qa-lead",
      }),
    );
  });

  it("defaults both roles to member while it is assignable", async () => {
    renderDialog();

    await submitEmail("new@example.com");

    await waitFor(() =>
      expect(createInvitation).toHaveBeenCalledWith({
        projectId: "project-1",
        email: "new@example.com",
        workspaceRole: "member",
        projectRole: "member",
      }),
    );
  });

  it("requires an explicit pick when member is not assignable", async () => {
    projectRoles = {
      data: [{ role: "viewer", isDefault: true }],
      isLoading: false,
      isError: false,
    };
    renderDialog();

    const send = screen.getByRole("button", {
      name: "projectInvitations:invite.submit",
    });
    expect(send).toBeDisabled();
    expect(
      screen.getByText("projectInvitations:invite.rolePickRequired"),
    ).toBeVisible();

    await pick(
      "projectInvitations:invite.projectRoleLabel",
      "team:roles.viewer",
    );
    expect(send).toBeEnabled();
  });

  it("says nothing can be invited when no project role is assignable", () => {
    projectRoles = { data: [], isLoading: false, isError: false };
    renderDialog();

    expect(
      screen.getByText("projectInvitations:invite.noAssignableRoles"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "projectInvitations:invite.submit" }),
    ).toBeDisabled();
  });

  it("shows loading and error states of the role lists", () => {
    workspaceRoles = { data: undefined, isLoading: true, isError: false };
    projectRoles = { data: undefined, isLoading: false, isError: true };
    renderDialog();

    expect(
      screen.getByText("projectInvitations:invite.rolesLoading"),
    ).toBeVisible();
    expect(
      screen.getByText("projectInvitations:invite.rolesError"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "projectInvitations:invite.submit" }),
    ).toBeDisabled();
  });

  it("starts from an earlier invitation when invited again", () => {
    renderDialog({
      prefill: {
        email: "old@example.com",
        workspaceRole: "viewer",
        projectRole: "qa-lead",
      },
    });

    expect(
      screen.getByPlaceholderText("projectInvitations:invite.emailPlaceholder"),
    ).toHaveValue("old@example.com");
    expect(
      screen.getByRole("combobox", {
        name: "projectInvitations:invite.workspaceRoleLabel",
      }),
    ).toHaveTextContent("team:roles.viewer");
    expect(
      screen.getByRole("combobox", {
        name: "projectInvitations:invite.projectRoleLabel",
      }),
    ).toHaveTextContent("Qa-Lead");
  });

  describe("email delivery notice", () => {
    it("warns up front when the server sends no email", () => {
      config = { hasSmtp: false };
      renderDialog();

      expect(
        screen.getByText("projectInvitations:invite.noSmtpNotice"),
      ).toBeVisible();
    });

    it("stays quiet when email is configured", () => {
      renderDialog();

      expect(
        screen.queryByText("projectInvitations:invite.noSmtpNotice"),
      ).toBeNull();
    });

    it("stays quiet while the configuration is unknown", () => {
      config = undefined;
      renderDialog();

      expect(
        screen.queryByText("projectInvitations:invite.noSmtpNotice"),
      ).toBeNull();
    });
  });

  describe("after the invitation was created", () => {
    it("shows the link and says the email was sent", async () => {
      renderDialog();

      await submitEmail("new@example.com");

      expect(
        await screen.findByText("projectInvitations:invite.createdSent"),
      ).toBeVisible();
      expect(screen.getByText("link:inv-1")).toBeVisible();
      expect(success).toHaveBeenCalledWith(
        "projectInvitations:invite.createdSent",
      );
    });

    it("says no email was sent when none was attempted", async () => {
      createInvitation.mockResolvedValue(
        created({ emailAttempted: false, emailSent: false }),
      );
      renderDialog();

      await submitEmail("new@example.com");

      expect(
        await screen.findByText("projectInvitations:invite.createdNotSent"),
      ).toBeVisible();
      expect(screen.getByText("link:inv-1")).toBeVisible();
    });

    it("says the email failed when the relay refused it", async () => {
      createInvitation.mockResolvedValue(
        created({ emailAttempted: true, emailSent: false }),
      );
      renderDialog();

      await submitEmail("new@example.com");

      expect(
        await screen.findByText("projectInvitations:invite.createdSendFailed"),
      ).toBeVisible();
    });

    it("says the project was added to an existing invitation, with no second email", async () => {
      createInvitation.mockResolvedValue({
        ...created({ emailAttempted: false, emailSent: false }),
        created: false,
      });
      renderDialog();

      await submitEmail("new@example.com");

      expect(
        await screen.findByText("projectInvitations:invite.addedToExisting"),
      ).toBeVisible();
      expect(screen.getByText("link:inv-1")).toBeVisible();
    });

    it("closes from the done button", async () => {
      renderDialog();
      await submitEmail("new@example.com");

      fireEvent.click(
        await screen.findByRole("button", {
          name: "projectInvitations:invite.done",
        }),
      );

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("error mapping", () => {
    const cases: [string, number, string][] = [
      [
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
        403,
        "projectMembers:errors.roleExceedsYourPermissions",
      ],
      [
        "OWNER_ROLE_NOT_ALLOWED",
        400,
        "projectMembers:errors.ownerRoleNotAllowed",
      ],
      ["UNKNOWN_ROLE", 400, "projectMembers:errors.unknownRole"],
      [
        "INVITATION_ROLE_CONFLICT",
        409,
        "projectInvitations:errors.roleConflict",
      ],
      [
        "WORKSPACE_INVITATION_EXISTS",
        409,
        "projectInvitations:errors.workspaceInvitationExists",
      ],
      [
        "DISPOSABLE_EMAIL_NOT_ALLOWED",
        400,
        "projectInvitations:errors.disposableEmail",
      ],
      [
        "INVITATION_LIMIT_REACHED",
        403,
        "projectInvitations:errors.limitReached",
      ],
      [
        "GUEST_CANNOT_INVITE",
        403,
        "projectInvitations:errors.guestCannotInvite",
      ],
    ];

    it.each(cases)(
      "maps %s to a translated message",
      async (code, status, key) => {
        createInvitation.mockRejectedValue(
          new ProjectMemberError("English text from the API", { code, status }),
        );
        renderDialog();

        await submitEmail("new@example.com");

        await waitFor(() => expect(error).toHaveBeenCalledWith(key));
        // The form stays open for a correction.
        expect(screen.queryByText(/^link:/)).toBeNull();
      },
    );

    it("reads a rate limit with the wait the API named", async () => {
      createInvitation.mockRejectedValue(
        new ProjectMemberError("Too many invitations, try again later.", {
          code: "RATE_LIMITED",
          status: 429,
          retryAfterSeconds: 42,
        }),
      );
      renderDialog();

      await submitEmail("new@example.com");

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          "projectInvitations:errors.rateLimitedRetry",
        ),
      );
    });

    it("falls back to the generic message for an unknown failure", async () => {
      createInvitation.mockRejectedValue(new Error("boom"));
      renderDialog();

      await submitEmail("new@example.com");

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith("projectInvitations:invite.error"),
      );
    });
  });

  describe("a person who already is a workspace member", () => {
    const alreadyMember = () =>
      new ProjectMemberError("This person is already a member", {
        code: "ALREADY_WORKSPACE_MEMBER",
        status: 409,
      });

    it("offers to add them as a member instead, with the project role chosen here", async () => {
      createInvitation.mockRejectedValue(alreadyMember());
      renderDialog({
        candidates: [{ id: "user-7", email: "Carol@Example.com" }],
        onAddExistingMember,
      });
      await pick("projectInvitations:invite.projectRoleLabel", "Qa-Lead");

      await submitEmail("carol@example.com");

      expect(
        await screen.findByText(
          "projectInvitations:errors.alreadyWorkspaceMember",
        ),
      ).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", {
          name: "projectInvitations:invite.addAsMember",
        }),
      );
      expect(onAddExistingMember).toHaveBeenCalledWith({
        userId: "user-7",
        role: "qa-lead",
      });
      expect(error).not.toHaveBeenCalled();
    });

    it("explains it without an add button when the person cannot be added directly", async () => {
      createInvitation.mockRejectedValue(alreadyMember());
      renderDialog({ candidates: [], onAddExistingMember });

      await submitEmail("carol@example.com");

      expect(
        await screen.findByText(
          "projectInvitations:errors.alreadyWorkspaceMember",
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: "projectInvitations:invite.addAsMember",
        }),
      ).toBeNull();
    });

    it("offers no add button to a caller who cannot add members", async () => {
      createInvitation.mockRejectedValue(alreadyMember());
      renderDialog({
        candidates: [{ id: "user-7", email: "carol@example.com" }],
      });

      await submitEmail("carol@example.com");

      await screen.findByText(
        "projectInvitations:errors.alreadyWorkspaceMember",
      );
      expect(
        screen.queryByRole("button", {
          name: "projectInvitations:invite.addAsMember",
        }),
      ).toBeNull();
    });
  });
});
