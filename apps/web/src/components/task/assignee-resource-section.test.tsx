import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    <select
      aria-label="kind"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

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
