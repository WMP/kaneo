import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type Resource from "@/types/resource";
import ResourceInviteDialog from "./resource-invite-dialog";

const m = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  success: vi.fn(),
  hasSmtp: true as boolean | undefined,
  workspaceRoles: {
    data: undefined as { role: string; isDefault: boolean }[] | undefined,
    isLoading: false,
  },
  projects: {
    data: undefined as
      | { id: string; name: string; hasAssignments: boolean }[]
      | undefined,
    isLoading: false,
    isError: false,
  },
  projectRoles: {} as Record<
    string,
    {
      isLoading: boolean;
      isError: boolean;
      roles: { role: string; isDefault: boolean }[] | undefined;
    }
  >,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));
vi.mock("@/hooks/mutations/resource/use-invite-resource", () => ({
  default: () => ({ mutateAsync: m.mutateAsync, isPending: m.isPending }),
}));
vi.mock("@/hooks/queries/resource/use-resource-invite-defaults", () => ({
  default: () => m.projects,
}));
vi.mock("@/hooks/queries/resource/use-project-assignable-roles", () => ({
  default: (ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        m.projectRoles[id] ?? {
          isLoading: true,
          isError: false,
          roles: undefined,
        },
      ]),
    ),
}));
vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => m.workspaceRoles,
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({
    data: m.hasSmtp === undefined ? undefined : { hasSmtp: m.hasSmtp },
  }),
}));
vi.mock("@/components/team/invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <div>link:{invitationId}</div>
  ),
}));
// A native select keeps the tests on behavior instead of the popup internals.
vi.mock("@/components/team/role-select", () => ({
  default: ({
    roles,
    value,
    onChange,
    ariaLabel,
    id,
  }: {
    roles: string[];
    value: string | null | undefined;
    onChange: (role: string) => void;
    ariaLabel?: string;
    id?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel ?? "workspace-role"}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        --
      </option>
      {roles.map((role) => (
        <option key={role} value={role}>
          {role}
        </option>
      ))}
    </select>
  ),
}));

const resource: Resource = {
  id: "r1",
  workspaceId: "ws-1",
  kind: "person",
  name: "Alice",
  email: "alice@example.com",
  userId: null,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
};

const roles = (...names: string[]) => ({
  isLoading: false,
  isError: false,
  roles: names.map((role) => ({ role, isDefault: false })),
});

function renderDialog(overrides: { onLinkInstead?: () => void } = {}) {
  const onClose = vi.fn();
  const onLinkInstead = overrides.onLinkInstead ?? vi.fn();
  render(
    <ResourceInviteDialog
      resource={resource}
      workspaceId="ws-1"
      onClose={onClose}
      onLinkInstead={onLinkInstead}
    />,
  );
  return { onClose, onLinkInstead };
}

const send = () =>
  screen.getByRole("button", { name: "team:inviteModal.sendInvitation" });

beforeEach(() => {
  m.hasSmtp = true;
  m.isPending = false;
  m.workspaceRoles = {
    data: [
      { role: "viewer", isDefault: true },
      { role: "member", isDefault: true },
      { role: "admin", isDefault: true },
    ],
    isLoading: false,
  };
  m.projects = {
    data: [
      { id: "p1", name: "Alpha", hasAssignments: true },
      { id: "p2", name: "Beta", hasAssignments: true },
      { id: "p3", name: "Gamma", hasAssignments: false },
    ],
    isLoading: false,
    isError: false,
  };
  m.projectRoles = {
    p1: roles("viewer", "member", "admin"),
    p2: roles("viewer", "member"),
    // The caller can grant nothing but viewer here.
    p3: roles("viewer"),
  };
  m.mutateAsync.mockResolvedValue({
    id: "inv-1",
    created: true,
    email: "alice@example.com",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResourceInviteDialog", () => {
  it("ticks the projects the resource has tasks in and sends the preferred roles", async () => {
    renderDialog();

    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).not.toBeChecked();
    expect(send()).toBeEnabled();

    fireEvent.click(send());

    await waitFor(() =>
      expect(m.mutateAsync).toHaveBeenCalledWith({
        id: "r1",
        workspaceRole: "member",
        projects: [
          { projectId: "p1", role: "member" },
          { projectId: "p2", role: "member" },
        ],
      }),
    );
  });

  it("needs an explicit role in a project where member cannot be granted", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    // Only viewer is offered there and it is never chosen silently.
    expect(send()).toBeDisabled();

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "settings:workspaceResources.invite.projectRoleLabel|Gamma",
      }),
      { target: { value: "viewer" } },
    );
    expect(send()).toBeEnabled();

    fireEvent.click(send());
    await waitFor(() =>
      expect(m.mutateAsync).toHaveBeenCalledWith({
        id: "r1",
        workspaceRole: "member",
        projects: [
          { projectId: "p1", role: "member" },
          { projectId: "p2", role: "member" },
          { projectId: "p3", role: "viewer" },
        ],
      }),
    );
  });

  it("sends the role picked for a project and for the workspace", async () => {
    renderDialog();

    fireEvent.change(screen.getByRole("combobox", { name: "workspace-role" }), {
      target: { value: "viewer" },
    });
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "settings:workspaceResources.invite.projectRoleLabel|Alpha",
      }),
      { target: { value: "admin" } },
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    fireEvent.click(send());

    await waitFor(() =>
      expect(m.mutateAsync).toHaveBeenCalledWith({
        id: "r1",
        workspaceRole: "viewer",
        projects: [{ projectId: "p1", role: "admin" }],
      }),
    );
  });

  it("does not send without a project", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));

    expect(send()).toBeDisabled();
    expect(
      screen.getByText("settings:workspaceResources.invite.pickProject"),
    ).toBeInTheDocument();
  });

  it("does not pick a workspace role for the user when member is not offered", () => {
    m.workspaceRoles = {
      data: [
        { role: "viewer", isDefault: true },
        { role: "qa-lead", isDefault: false },
      ],
      isLoading: false,
    };
    renderDialog();

    expect(send()).toBeDisabled();
    expect(screen.getByText("team:inviteModal.rolePickRequired")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "workspace-role" }), {
      target: { value: "qa-lead" },
    });
    expect(send()).toBeEnabled();
  });

  it("says so when the caller can invite to no project", () => {
    m.projects = { data: [], isLoading: false, isError: false };
    renderDialog();

    expect(
      screen.getByText("settings:workspaceResources.invite.noProjects"),
    ).toBeVisible();
    expect(send()).toBeDisabled();
  });

  it("shows a failure to load the projects or the roles instead of an empty form", () => {
    m.projects = { data: undefined, isLoading: false, isError: true };
    m.workspaceRoles = { data: undefined, isLoading: false };
    renderDialog();

    expect(
      screen.getByText("settings:workspaceResources.invite.projectsError"),
    ).toBeVisible();
    expect(screen.getByText("team:inviteModal.rolesError")).toBeVisible();
    expect(send()).toBeDisabled();
  });

  it("warns when email is not configured on the server", () => {
    m.hasSmtp = false;
    renderDialog();
    expect(screen.getByText("team:inviteModal.noSmtpNotice")).toBeVisible();
  });

  it("shows the accept link after sending", async () => {
    renderDialog();
    fireEvent.click(send());

    expect(await screen.findByText("link:inv-1")).toBeVisible();
    expect(
      screen.getByText("settings:workspaceResources.invite.createdTitle"),
    ).toBeVisible();
    expect(m.success).toHaveBeenCalledWith("team:inviteModal.success");
  });

  it("says the projects were added when a pending invitation existed", async () => {
    m.mutateAsync.mockResolvedValue({
      id: "inv-0",
      created: false,
      email: "alice@example.com",
    });
    renderDialog();
    fireEvent.click(send());

    expect(await screen.findByText("link:inv-0")).toBeVisible();
    expect(m.success).toHaveBeenCalledWith(
      "settings:workspaceResources.invite.addedToExisting",
    );
  });

  it("translates the error code and offers to link when the address is a member's", async () => {
    m.mutateAsync.mockRejectedValue(
      new HttpError(
        409,
        JSON.stringify({ code: "ALREADY_WORKSPACE_MEMBER", message: "raw" }),
      ),
    );
    const { onLinkInstead } = renderDialog();
    fireEvent.click(send());

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "settings:workspaceResources.errors.alreadyWorkspaceMember",
      ),
    ).toBeVisible();
    expect(within(alert).queryByText("raw")).toBeNull();

    fireEvent.click(
      within(alert).getByRole("button", {
        name: "settings:workspaceResources.linkAction",
      }),
    );
    expect(onLinkInstead).toHaveBeenCalledWith(resource);
  });

  it.each([
    [
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      "settings:workspaceResources.errors.roleExceedsYourPermissions",
    ],
    [
      403,
      "INSUFFICIENT_PERMISSIONS",
      "settings:workspaceResources.errors.insufficientPermissions",
    ],
    [429, "RATE_LIMITED", "settings:workspaceResources.errors.rateLimited"],
  ])("maps %s %s to translated copy", async (status, code, key) => {
    m.mutateAsync.mockRejectedValue(
      new HttpError(status, JSON.stringify({ code, message: "raw" })),
    );
    renderDialog();
    fireEvent.click(send());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(key)).toBeVisible();
    expect(
      within(alert).queryByRole("button", {
        name: "settings:workspaceResources.linkAction",
      }),
    ).toBeNull();
    // The dialog stays open on the form so the caller can adjust and retry.
    expect(send()).toBeEnabled();
  });

  it("falls back to a generic message for an error without a known code", async () => {
    m.mutateAsync.mockRejectedValue(
      new HttpError(500, "Internal Server Error"),
    );
    renderDialog();
    fireEvent.click(send());

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("settings:workspaceResources.invite.error"),
    ).toBeVisible();
  });
});
