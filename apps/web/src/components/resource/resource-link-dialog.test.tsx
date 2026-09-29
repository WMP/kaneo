import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemberError } from "@/lib/project-member-error";
import type Resource from "@/types/resource";
import ResourceLinkDialog from "./resource-link-dialog";

const m = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  success: vi.fn(),
  members: {
    data: undefined as
      | {
          userId: string;
          user: { name: string; email: string };
        }[]
      | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));
vi.mock("@/hooks/mutations/resource/use-link-resource", () => ({
  default: () => ({ mutateAsync: m.mutateAsync, isPending: false }),
}));
vi.mock("@/hooks/queries/workspace/use-get-workspace-members", () => ({
  default: () => m.members,
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
    value: string | null;
  }) => (
    <select
      aria-label="member"
      value={value ?? ""}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" disabled>
        --
      </option>
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

function renderDialog() {
  const onClose = vi.fn();
  render(
    <ResourceLinkDialog
      resource={resource}
      workspaceId="ws-1"
      onClose={onClose}
    />,
  );
  return { onClose };
}

const submit = () =>
  screen.getByRole("button", {
    name: "settings:workspaceResources.link.submit",
  });

beforeEach(() => {
  m.members = {
    data: [
      { userId: "u2", user: { name: "Zed", email: "zed@example.com" } },
      { userId: "u1", user: { name: "Ann", email: "ann@example.com" } },
    ],
    isLoading: false,
    isError: false,
  };
  m.mutateAsync.mockResolvedValue({
    resource: { user: { name: "Ann" } },
    movedTaskCount: 3,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResourceLinkDialog", () => {
  it("lists members by name and links the chosen one", async () => {
    const { onClose } = renderDialog();

    const options = within(screen.getByRole("combobox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "--",
      "Ann (ann@example.com)",
      "Zed (zed@example.com)",
    ]);
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u1" } });
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());

    await waitFor(() =>
      expect(m.mutateAsync).toHaveBeenCalledWith({ id: "r1", userId: "u1" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(m.success).toHaveBeenCalledWith(
      "settings:workspaceResources.link.success|Ann|3",
    );
  });

  it("keeps the dialog open with a translated message when linking fails", async () => {
    m.mutateAsync.mockRejectedValue(
      new ProjectMemberError("raw", {
        status: 409,
        code: "RESOURCE_ALREADY_LINKED",
      }),
    );
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u1" } });
    fireEvent.click(submit());

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "settings:workspaceResources.errors.alreadyLinked",
      ),
    ).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when there is nobody to link", () => {
    m.members = { data: [], isLoading: false, isError: false };
    renderDialog();
    expect(
      screen.getByText("settings:workspaceResources.link.noMembers"),
    ).toBeVisible();
    expect(submit()).toBeDisabled();
  });

  it("shows a failure to load the members", () => {
    m.members = { data: undefined, isLoading: false, isError: true };
    renderDialog();
    expect(
      screen.getByText("settings:workspaceResources.link.membersError"),
    ).toBeVisible();
    expect(submit()).toBeDisabled();
  });
});
