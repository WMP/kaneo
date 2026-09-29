import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Resource from "@/types/resource";
import { Route } from "./resources";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

const m = vi.hoisted(() => ({
  create: vi.fn(),
  createPending: false,
  unlink: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  canManage: true,
  canLink: true,
  resources: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string }) =>
      options?.defaultValue ?? (options?.name ? `${key}|${options.name}` : key),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "workspace-1" },
    canUpdateProjects: () => m.canManage,
    canLinkResources: () => m.canLink,
  }),
}));
vi.mock("@/hooks/queries/resource/use-get-workspace-resources", () => ({
  default: () => ({ data: m.resources }),
}));
vi.mock("@/hooks/mutations/resource/use-create-resource", () => ({
  default: () => ({ mutateAsync: m.create, isPending: m.createPending }),
}));
vi.mock("@/hooks/mutations/resource/use-update-resource", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/resource/use-delete-resource", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/resource/use-unlink-resource", () => ({
  default: () => ({ mutateAsync: m.unlink, isPending: false }),
}));
// The dialogs have their own tests; here they only show that the route opened
// the right one for the right resource.
vi.mock("@/components/resource/resource-invite-dialog", () => ({
  default: ({
    resource,
    onLinkInstead,
    canLink,
  }: {
    resource: Resource;
    onLinkInstead: (resource: Resource) => void;
    canLink: boolean;
  }) => (
    <div role="dialog" aria-label="invite-dialog">
      invite:{resource.id}:{canLink ? "can-link" : "no-link"}
      <button type="button" onClick={() => onLinkInstead(resource)}>
        switch-to-link
      </button>
    </div>
  ),
}));
vi.mock("@/components/resource/resource-link-dialog", () => ({
  default: ({ resource }: { resource: Resource }) => (
    <div role="dialog" aria-label="link-dialog">
      link:{resource.id}
    </div>
  ),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

const Component = Route.options.component as ComponentType;

const base = {
  workspaceId: "workspace-1",
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
};

function makeResources(): Resource[] {
  return [
    {
      ...base,
      id: "r1",
      kind: "person",
      name: "Contractor Carl",
      email: null,
      userId: null,
    },
    {
      ...base,
      id: "r2",
      kind: "equipment",
      name: "Drill",
      email: null,
      userId: null,
    },
  ];
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.createPending = false;
  m.canManage = true;
  m.canLink = true;
  m.resources = makeResources();
});

describe("workspace resources settings", () => {
  it("lists resources grouped with a kind indicator", () => {
    render(<Component />);

    expect(screen.getByText("Contractor Carl")).toBeInTheDocument();
    expect(screen.getByText("Drill")).toBeInTheDocument();
  });

  it("creates a new resource from the dialog", async () => {
    m.create.mockResolvedValue({
      id: "r3",
      workspaceId: "workspace-1",
      kind: "person",
      name: "New Person",
      email: null,
      userId: null,
      createdAt: "2026-09-19T12:00:00Z",
      updatedAt: "2026-09-19T12:00:00Z",
    });

    render(<Component />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceResources.createResource",
      }),
    );

    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByLabelText(
      "settings:workspaceResources.nameLabel",
    );
    fireEvent.change(nameInput, { target: { value: "New Person" } });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:workspaceResources.createResource",
      }),
    );

    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        kind: "person",
        name: "New Person",
        email: undefined,
      }),
    );
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith(
        "settings:workspaceResources.createSuccess",
      ),
    );
  });

  it("shows a validation error and does not submit when the name is blank", () => {
    render(<Component />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceResources.createResource",
      }),
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:workspaceResources.createResource",
      }),
    );

    expect(
      screen.getByText("settings:workspaceResources.nameRequired"),
    ).toBeInTheDocument();
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("person resource statuses and actions", () => {
  const invite = () =>
    screen.queryByRole("button", {
      name: "settings:workspaceResources.inviteAction",
    });
  const link = () =>
    screen.queryByRole("button", {
      name: "settings:workspaceResources.linkAction",
    });
  const unlink = () =>
    screen.queryByRole("button", {
      name: "settings:workspaceResources.unlinkAction",
    });

  it("shows 'Not invited' and disables Invite for a person without an email", () => {
    render(<Component />);

    expect(
      screen.getByText("settings:workspaceResources.status.notInvited"),
    ).toBeInTheDocument();
    expect(invite()).toBeDisabled();
    // Only the person has a status and the invite actions.
    expect(
      screen.getAllByText("settings:workspaceResources.status.notInvited"),
    ).toHaveLength(1);
  });

  it("enables Invite for a person with an email and opens the dialog for it", () => {
    m.resources = [
      { ...makeResources()[0], email: "carl@example.com" },
    ] as Resource[];
    render(<Component />);

    expect(screen.getByText("carl@example.com")).toBeInTheDocument();
    expect(invite()).toBeEnabled();
    fireEvent.click(invite() as HTMLElement);
    expect(
      screen.getByRole("dialog", { name: "invite-dialog" }),
    ).toHaveTextContent("invite:r1");
  });

  it("switches from the invite dialog to the link dialog when the address is a member's", () => {
    m.resources = [
      { ...makeResources()[0], email: "carl@example.com" },
    ] as Resource[];
    render(<Component />);
    fireEvent.click(invite() as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "switch-to-link" }));

    expect(screen.queryByRole("dialog", { name: "invite-dialog" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "link-dialog" }),
    ).toHaveTextContent("link:r1");
  });

  it.each([
    ["pending", "settings:workspaceResources.status.invitedPending"],
    ["expired", "settings:workspaceResources.status.invitedExpired"],
  ] as const)(
    "shows an %s invitation and still offers to invite again",
    (status, label) => {
      m.resources = [
        {
          ...makeResources()[0],
          email: "carl@example.com",
          invitation: { status, expiresAt: "2026-10-01T00:00:00Z" },
        },
      ] as Resource[];
      render(<Component />);

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(invite()).toBeEnabled();
    },
  );

  it("shows the linked member and offers Unlink instead of Invite and Link", () => {
    m.resources = [
      {
        ...makeResources()[0],
        email: "carl@example.com",
        userId: "u1",
        user: {
          id: "u1",
          name: "Carl Member",
          email: "carl@example.com",
          image: null,
        },
      },
    ] as Resource[];
    render(<Component />);

    expect(
      screen.getByText(
        "settings:workspaceResources.status.linkedTo|Carl Member",
      ),
    ).toBeInTheDocument();
    expect(invite()).toBeNull();
    expect(link()).toBeNull();
    expect(unlink()).toBeInTheDocument();
  });

  it("says only 'linked' when the caller cannot see the member", () => {
    m.resources = [
      { ...makeResources()[0], userId: "u1", user: null },
    ] as Resource[];
    render(<Component />);
    expect(
      screen.getByText("settings:workspaceResources.status.linked"),
    ).toBeInTheDocument();
  });

  it("unlinks after a confirmation", async () => {
    m.unlink.mockResolvedValue({ id: "r1" });
    m.resources = [
      { ...makeResources()[0], userId: "u1", user: null },
    ] as Resource[];
    render(<Component />);

    fireEvent.click(unlink() as HTMLElement);
    const dialog = screen.getByRole("alertdialog");
    expect(m.unlink).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:workspaceResources.unlinkAction",
      }),
    );

    await waitFor(() => expect(m.unlink).toHaveBeenCalledWith({ id: "r1" }));
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith(
        "settings:workspaceResources.unlink.success",
      ),
    );
  });

  it("hides Link and Unlink from somebody who cannot link resources", () => {
    m.canLink = false;
    m.resources = [
      { ...makeResources()[0], email: "carl@example.com" },
      {
        ...makeResources()[0],
        id: "r9",
        name: "Linked Lena",
        userId: "u1",
        user: null,
      },
    ] as Resource[];
    render(<Component />);

    expect(invite()).toBeEnabled();
    expect(link()).toBeNull();
    expect(unlink()).toBeNull();
    // The invite dialog is told, so it does not offer a link that would fail.
    fireEvent.click(invite() as HTMLElement);
    expect(
      screen.getByRole("dialog", { name: "invite-dialog" }),
    ).toHaveTextContent("invite:r1:no-link");
  });

  it("offers none of the actions to somebody who cannot manage resources", () => {
    m.canManage = false;
    m.resources = [
      { ...makeResources()[0], email: "carl@example.com" },
    ] as Resource[];
    render(<Component />);

    expect(invite()).toBeNull();
    expect(link()).toBeNull();
  });
});
