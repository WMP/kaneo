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
import { Route } from "./resources";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

const m = vi.hoisted(() => ({
  create: vi.fn(),
  createPending: false,
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "workspace-1" },
    canUpdateProjects: () => true,
  }),
}));
vi.mock("@/hooks/queries/resource/use-get-workspace-resources", () => ({
  default: () => ({
    data: [
      {
        id: "r1",
        workspaceId: "workspace-1",
        kind: "person",
        name: "Contractor Carl",
        email: null,
        userId: null,
        createdAt: "2026-09-19T12:00:00Z",
        updatedAt: "2026-09-19T12:00:00Z",
      },
      {
        id: "r2",
        workspaceId: "workspace-1",
        kind: "equipment",
        name: "Drill",
        email: null,
        userId: null,
        createdAt: "2026-09-19T12:00:00Z",
        updatedAt: "2026-09-19T12:00:00Z",
      },
    ],
  }),
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
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

const Component = Route.options.component as ComponentType;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.createPending = false;
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
