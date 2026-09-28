import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomFieldEditor from "./custom-field-editor";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const inheritedRequired = {
  id: "ws-required",
  projectId: null,
  workspaceId: "workspace-1",
  scope: "workspace" as const,
  hideable: false,
  hidden: false,
  name: "Compliance tag",
  type: "text" as const,
  required: true,
  defaultValue: null,
  options: null,
  optionColors: null,
  position: 0,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const inheritedOptional = {
  ...inheritedRequired,
  id: "ws-optional",
  name: "Team",
  hideable: true,
  required: false,
  position: 1,
};

const ownField = {
  id: "own-1",
  projectId: "project-1",
  workspaceId: null,
  scope: "project" as const,
  hideable: false,
  hidden: false,
  name: "Story points",
  type: "number" as const,
  required: false,
  defaultValue: null,
  options: null,
  optionColors: null,
  position: 0,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const allFields = [inheritedRequired, inheritedOptional, ownField];

const m = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  reorder: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  setVisibility: vi.fn().mockResolvedValue(undefined),
}));

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: allFields, isLoading: false }),
  }),
);
vi.mock("@/hooks/mutations/custom-field/use-create-custom-field", () => ({
  default: () => ({ mutateAsync: m.create, isPending: false }),
}));
vi.mock("@/hooks/mutations/custom-field/use-delete-custom-field", () => ({
  default: () => ({ mutateAsync: m.delete, isPending: false }),
}));
vi.mock("@/hooks/mutations/custom-field/use-reorder-custom-field", () => ({
  useReorderCustomFields: () => ({ mutateAsync: m.reorder }),
}));
vi.mock("@/hooks/mutations/custom-field/use-update-custom-field", () => ({
  default: () => ({ mutateAsync: m.update }),
}));
vi.mock(
  "@/hooks/mutations/custom-field/use-set-custom-field-visibility",
  () => ({
    default: () => ({ mutateAsync: m.setVisibility }),
  }),
);

describe("CustomFieldEditor (project)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists inherited workspace fields separately from the project's own fields", () => {
    render(<CustomFieldEditor projectId="project-1" />);

    expect(screen.getByText("Compliance tag")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Story points")).toBeInTheDocument();
  });

  it("disables the visibility toggle for a required inherited field", () => {
    render(<CustomFieldEditor projectId="project-1" />);

    const requiredRow = screen.getByText("Compliance tag").closest("div.flex");
    expect(requiredRow).not.toBeNull();
    const toggle = screen.getAllByRole("switch")[0];
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("settings:customFields.requiredByWorkspace"),
    ).toBeInTheDocument();
  });

  it("hides an optional inherited field through the visibility toggle", () => {
    render(<CustomFieldEditor projectId="project-1" />);

    const switches = screen.getAllByRole("switch");
    // First inherited row is the required (locked) one; second is optional.
    const optionalToggle = switches[1];
    expect(optionalToggle).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(optionalToggle);

    expect(m.setVisibility).toHaveBeenCalledWith({
      fieldId: "ws-optional",
      hidden: true,
    });
  });

  it("creates a project-owned field scoped to this project", () => {
    render(<CustomFieldEditor projectId="project-1" />);

    fireEvent.change(
      screen.getByPlaceholderText("settings:customFields.namePlaceholder"),
      { target: { value: "Risk" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:customFields.addButton" }),
    );

    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", name: "Risk" }),
    );
  });
});
