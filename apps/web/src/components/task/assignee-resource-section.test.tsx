import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createContext, useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemberError } from "@/lib/project-member-error";
import type Resource from "@/types/resource";
import AssigneeResourceSection, {
  getPickableResources,
} from "./assignee-resource-section";

const m = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/resource/use-create-resource", () => ({
  default: () => ({ mutateAsync: m.create, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: m.error },
}));

// A native select keeps the test on behavior instead of the popup internals.
// The trigger and its value are rendered (as the real ones do) so a test can
// see what the closed select shows; the real `SelectValue` only shows the raw
// value when it has no children.
const SelectContext = createContext<{
  value: string;
  onValueChange: (value: string) => void;
}>({ value: "", onValueChange: () => {} });

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="kind-trigger">{children}</span>
  ),
  SelectValue: ({ children }: { children?: React.ReactNode }) => (
    <SelectValueContent>{children}</SelectValueContent>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => {
    const { value, onValueChange } = useContext(SelectContext);
    return (
      <select
        aria-label="kind"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {children}
      </select>
    );
  },
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

function SelectValueContent({ children }: { children?: React.ReactNode }) {
  // Like the real component: no children means the raw value is shown.
  const { value } = useContext(SelectContext);
  return <>{children ?? value}</>;
}

const make = (id: string, name: string, userId: string | null): Resource => ({
  id,
  workspaceId: "ws-1",
  kind: "person",
  name,
  email: null,
  userId,
  linked: userId !== null,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
});

const makeInvitable = (
  id: string,
  name: string,
  overrides: Partial<Resource> = {},
): Resource => ({
  ...make(id, name, null),
  email: `${name.toLowerCase().replace(/\s/g, ".")}@example.com`,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const resources = [
  make("r1", "Free Fred", null),
  make("r2", "Linked Lena", "u2"),
];

describe("getPickableResources", () => {
  const ids = (list: Resource[]) => list.map((resource) => resource.id);

  it("leaves out a linked resource only where its account is a project member", () => {
    expect(
      ids(getPickableResources(resources, new Set(["u2"]), new Set())),
    ).toEqual(["r1"]);
    // In a project the account is not in, the resource is how the person is
    // assigned.
    expect(
      ids(getPickableResources(resources, new Set(["u9"]), new Set())),
    ).toEqual(["r1", "r2"]);
  });

  it("keeps a linked resource the task really has, so it can be removed", () => {
    expect(
      ids(getPickableResources(resources, new Set(["u2"]), new Set(["r2"]))),
    ).toEqual(["r1", "r2"]);
  });
});

describe("AssigneeResourceSection", () => {
  const renderSection = (
    props: Partial<Parameters<typeof AssigneeResourceSection>[0]> = {},
  ) =>
    render(
      <AssigneeResourceSection
        workspaceId="ws-1"
        resources={resources}
        projectUserIds={["u2"]}
        selectedResourceIds={[]}
        onToggleResource={vi.fn()}
        canCreateResource={false}
        {...props}
      />,
    );

  it("leaves out a resource whose account is listed as a person", () => {
    renderSection();

    expect(screen.getByText("Free Fred")).toBeInTheDocument();
    expect(screen.queryByText("Linked Lena")).toBeNull();
  });

  it("does not hide a linked resource that was just toggled in the open popover", () => {
    // Toggled locally (selected) but not on the task: still listed either way.
    renderSection({ projectUserIds: ["u9"], selectedResourceIds: ["r2"] });
    expect(screen.getByText("Linked Lena")).toBeInTheDocument();
  });

  it("keeps a linked resource in the list after it was deselected", () => {
    // Where its account is a project member the resource is normally left out;
    // one that was selected while the popover was open must not vanish when it
    // is toggled off, so it can be selected again.
    const view = renderSection({ selectedResourceIds: ["r2"] });
    expect(screen.getByText("Linked Lena")).toBeInTheDocument();
    view.rerender(
      <AssigneeResourceSection
        workspaceId="ws-1"
        resources={resources}
        projectUserIds={["u2"]}
        selectedResourceIds={[]}
        onToggleResource={vi.fn()}
        canCreateResource={false}
      />,
    );
    expect(screen.getByText("Linked Lena")).toBeInTheDocument();
  });

  it("keeps a linked resource that is on the task", () => {
    renderSection({ assignedResourceIds: ["r2"], selectedResourceIds: [] });
    expect(screen.getByText("Linked Lena")).toBeInTheDocument();
  });

  it("offers an email only for a person when creating a resource inline", () => {
    renderSection({ canCreateResource: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.addResource",
      }),
    );
    const emailPlaceholder =
      "tasks:popover.assignee.newResourceEmailPlaceholder";
    expect(screen.getByPlaceholderText(emailPlaceholder)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "equipment" },
    });
    expect(screen.queryByPlaceholderText(emailPlaceholder)).toBeNull();
  });

  it("shows the translated kind label, not the raw value, in the kind select trigger", () => {
    renderSection({ canCreateResource: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.addResource",
      }),
    );
    const trigger = screen.getByTestId("kind-trigger");
    expect(trigger).toHaveTextContent(
      "tasks:popover.assignee.resourceKind.person",
    );
    expect(trigger).not.toHaveTextContent(/^person$/);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "equipment" },
    });
    expect(screen.getByTestId("kind-trigger")).toHaveTextContent(
      "tasks:popover.assignee.resourceKind.equipment",
    );
  });

  it("shows a translated message, never the raw body, when creating fails", async () => {
    m.create.mockRejectedValue(
      new ProjectMemberError('{"code":"RESOURCE_EMAIL_NOT_ALLOWED"}', {
        status: 400,
        code: "RESOURCE_EMAIL_NOT_ALLOWED",
      }),
    );
    renderSection({ canCreateResource: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.addResource",
      }),
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "tasks:popover.assignee.newResourceNamePlaceholder",
      ),
      { target: { value: "New" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.createResource",
      }),
    );
    await vi.waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "settings:workspaceResources.errors.emailNotAllowed",
      ),
    );
  });
});

describe("AssigneeResourceSection invitations", () => {
  const inviteLabel = "tasks:popover.assignee.inviteResource";
  const pendingLabel = "tasks:popover.assignee.invitationPending";

  const renderSection = (
    props: Partial<Parameters<typeof AssigneeResourceSection>[0]> = {},
  ) =>
    render(
      <AssigneeResourceSection
        workspaceId="ws-1"
        resources={[]}
        projectUserIds={[]}
        selectedResourceIds={[]}
        onToggleResource={vi.fn()}
        canCreateResource={true}
        {...props}
      />,
    );

  const createInline = (values: { name: string; email?: string }) => {
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.addResource",
      }),
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "tasks:popover.assignee.newResourceNamePlaceholder",
      ),
      { target: { value: values.name } },
    );
    if (values.email !== undefined) {
      fireEvent.change(
        screen.getByPlaceholderText(
          "tasks:popover.assignee.newResourceEmailPlaceholder",
        ),
        { target: { value: values.email } },
      );
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.createResource",
      }),
    );
  };

  it("hands a person created with an email to onInviteResource, after selecting it", async () => {
    const created = makeInvitable("new", "Nina", { email: "nina@example.com" });
    m.create.mockResolvedValue(created);
    const calls: string[] = [];
    const onToggleResource = vi.fn(() => calls.push("toggle"));
    const onInviteResource = vi.fn(() => calls.push("invite"));
    renderSection({ onToggleResource, onInviteResource });

    createInline({ name: "Nina", email: " nina@example.com " });

    await vi.waitFor(() => expect(onInviteResource).toHaveBeenCalledOnce());
    expect(m.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      kind: "person",
      name: "Nina",
      email: "nina@example.com",
    });
    expect(onInviteResource).toHaveBeenCalledWith(created);
    expect(onToggleResource).toHaveBeenCalledWith("new");
    expect(calls).toEqual(["toggle", "invite"]);
  });

  it("does not offer an invitation for a person created without an email", async () => {
    m.create.mockResolvedValue(make("new", "Nina", null));
    const onToggleResource = vi.fn();
    const onInviteResource = vi.fn();
    renderSection({ onToggleResource, onInviteResource });

    createInline({ name: "Nina", email: "   " });

    await vi.waitFor(() =>
      expect(onToggleResource).toHaveBeenCalledWith("new"),
    );
    expect(onInviteResource).not.toHaveBeenCalled();
  });

  it("does not offer an invitation for equipment", async () => {
    m.create.mockResolvedValue({
      ...make("new", "Drill", null),
      kind: "equipment",
    });
    const onToggleResource = vi.fn();
    const onInviteResource = vi.fn();
    renderSection({ onToggleResource, onInviteResource });

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.addResource",
      }),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "equipment" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "tasks:popover.assignee.newResourceNamePlaceholder",
      ),
      { target: { value: "Drill" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.createResource",
      }),
    );

    await vi.waitFor(() =>
      expect(onToggleResource).toHaveBeenCalledWith("new"),
    );
    expect(m.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      kind: "equipment",
      name: "Drill",
      email: undefined,
    });
    expect(onInviteResource).not.toHaveBeenCalled();
  });

  it("creates a person with an email as before when there is no onInviteResource", async () => {
    m.create.mockResolvedValue(
      makeInvitable("new", "Nina", { email: "nina@example.com" }),
    );
    const onToggleResource = vi.fn();
    renderSection({ onToggleResource });

    createInline({ name: "Nina", email: "nina@example.com" });

    await vi.waitFor(() =>
      expect(onToggleResource).toHaveBeenCalledWith("new"),
    );
  });

  it("does not offer an invitation when creating fails", async () => {
    m.create.mockRejectedValue(new Error("boom"));
    const onInviteResource = vi.fn();
    renderSection({ onInviteResource });

    createInline({ name: "Nina", email: "nina@example.com" });

    await vi.waitFor(() => expect(m.error).toHaveBeenCalled());
    expect(onInviteResource).not.toHaveBeenCalled();
  });

  it("lists an invite button beside each person with an email who can still be invited", () => {
    const fred = makeInvitable("r1", "Free Fred");
    const expired = makeInvitable("r2", "Late Lena", {
      invitation: { status: "expired", expiresAt: "2026-09-01T00:00:00Z" },
    });
    const onInviteResource = vi.fn();
    const onToggleResource = vi.fn();
    renderSection({
      resources: [fred, expired],
      onInviteResource,
      onToggleResource,
    });

    const buttons = screen.getAllByRole("button", { name: inviteLabel });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute("title", inviteLabel);

    fireEvent.click(buttons[0]);
    expect(onInviteResource).toHaveBeenCalledExactlyOnceWith(fred);
    // The invite button is not part of the toggle button.
    expect(onToggleResource).not.toHaveBeenCalled();
    expect(buttons[0].parentElement?.closest("button")).toBeNull();
  });

  it("shows a muted note instead of the button while an invitation is pending", () => {
    renderSection({
      resources: [
        makeInvitable("r1", "Pending Pam", {
          invitation: { status: "pending", expiresAt: "2026-12-01T00:00:00Z" },
        }),
      ],
      onInviteResource: vi.fn(),
    });

    expect(screen.getByText(pendingLabel)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
  });

  it("offers no invitation for equipment, a person without an email or a linked person", () => {
    renderSection({
      resources: [
        { ...makeInvitable("r1", "Drill"), kind: "equipment" },
        make("r2", "No Mail Mo", null),
        makeInvitable("r3", "Linked Lee", { userId: "u9", linked: true }),
      ],
      onInviteResource: vi.fn(),
    });

    expect(screen.getByText("Drill")).toBeInTheDocument();
    expect(screen.getByText("No Mail Mo")).toBeInTheDocument();
    expect(screen.getByText("Linked Lee")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
    expect(screen.queryByText(pendingLabel)).toBeNull();
  });

  it("shows no invite UI without onInviteResource", () => {
    renderSection({
      resources: [
        makeInvitable("r1", "Free Fred"),
        makeInvitable("r2", "Pending Pam", {
          invitation: { status: "pending", expiresAt: "2026-12-01T00:00:00Z" },
        }),
      ],
    });

    expect(screen.getByText("Free Fred")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
    expect(screen.queryByText(pendingLabel)).toBeNull();
  });

  it("keeps the row toggle working and free of nested buttons", () => {
    const onToggleResource = vi.fn();
    renderSection({
      resources: [makeInvitable("r1", "Free Fred")],
      selectedResourceIds: ["r1"],
      onInviteResource: vi.fn(),
      onToggleResource,
    });

    const toggle = screen.getByRole("button", { name: /Free Fred/ });
    expect(toggle.querySelector("button")).toBeNull();
    fireEvent.click(toggle);
    expect(onToggleResource).toHaveBeenCalledWith("r1");
  });
});
