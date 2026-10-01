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
import { Route } from "./custom-fields";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
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
  useWorkspacePermission: () => ({ workspace: { id: "workspace-1" } }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  reorder: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
}));

const workspaceFields = [
  {
    id: "wf-1",
    projectId: null,
    workspaceId: "workspace-1",
    scope: "workspace" as const,
    hideable: true,
    hidden: false,
    name: "Priority tier",
    type: "text" as const,
    required: false,
    defaultValue: null,
    options: null,
    optionColors: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
];

vi.mock("@/hooks/queries/custom-field/use-get-workspace-custom-fields", () => ({
  default: () => ({ data: workspaceFields, isLoading: false }),
}));
vi.mock(
  "@/hooks/mutations/custom-field/use-create-workspace-custom-field",
  () => ({
    default: () => ({ mutateAsync: m.create, isPending: false }),
  }),
);
vi.mock(
  "@/hooks/mutations/custom-field/use-delete-workspace-custom-field",
  () => ({
    default: () => ({ mutateAsync: m.delete, isPending: false }),
  }),
);
vi.mock(
  "@/hooks/mutations/custom-field/use-reorder-workspace-custom-fields",
  () => ({
    default: () => ({ mutateAsync: m.reorder }),
  }),
);
vi.mock(
  "@/hooks/mutations/custom-field/use-update-workspace-custom-field",
  () => ({
    default: () => ({ mutateAsync: m.update }),
  }),
);

const Component = Route.options.component as ComponentType;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
});

describe("workspace custom fields settings", () => {
  it("lists the workspace's custom fields", () => {
    render(<Component />);

    expect(screen.getByText("Priority tier")).toBeInTheDocument();
  });

  it("creates a new workspace-level field scoped to the active workspace", () => {
    render(<Component />);

    fireEvent.change(
      screen.getByPlaceholderText("settings:customFields.namePlaceholder"),
      { target: { value: "Region" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:customFields.addButton" }),
    );

    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", name: "Region" }),
    );
  });

  it("edits a workspace field through the workspace update hook", async () => {
    render(<Component />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:customFields.editFieldAriaLabel",
      }),
    );
    const form = screen.getByRole("form", {
      name: "settings:customFields.editFormAriaLabel",
    });
    fireEvent.change(
      within(form).getByLabelText("settings:customFields.nameLabel"),
      { target: { value: "Tier" } },
    );
    fireEvent.click(
      within(form).getByRole("button", {
        name: "settings:customFields.saveButton",
      }),
    );

    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({ id: "wf-1", name: "Tier" }),
    );
  });
});
