import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { CustomFieldsPage } from "@/components/project/custom-fields/custom-fields-page";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => 1,
}));

const base = {
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
const inheritedRequired = { ...base, id: "ws-required" };
const inheritedOptional = {
  ...base,
  id: "ws-optional",
  name: "Team",
  hideable: true,
  required: false,
  position: 1,
};
const ownField = {
  ...base,
  id: "own-1",
  projectId: "project-1",
  workspaceId: null,
  scope: "project" as const,
  name: "Story points",
  type: "number" as const,
  required: false,
};

const m = vi.hoisted(() => ({
  setVisibility: vi.fn(),
  canUpdate: true,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateProjects: () => m.canUpdate }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { id: "project-1", name: "Website" } }),
}));
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({
      data: [inheritedRequired, inheritedOptional, ownField],
      isLoading: false,
    }),
  }),
);
vi.mock("@/hooks/mutations/custom-field/use-create-custom-field", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/custom-field/use-update-custom-field", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/custom-field/use-delete-custom-field", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/custom-field/use-reorder-custom-field", () => ({
  useReorderCustomFields: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock(
  "@/hooks/mutations/custom-field/use-set-custom-field-visibility",
  () => ({ default: () => ({ mutateAsync: m.setVisibility }) }),
);

describe("CustomFieldsPage inherited workspace fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.canUpdate = true;
    m.setVisibility.mockResolvedValue(undefined);
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  });
  afterEach(cleanup);

  it("lists inherited workspace fields apart from the project's own fields", () => {
    render(<CustomFieldsPage projectId="project-1" />);

    expect(screen.getByText("Compliance tag")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Story points")).toBeInTheDocument();
    // The own-field list does not repeat the inherited ones.
    expect(screen.getAllByText("Team")).toHaveLength(1);
  });

  it("locks the visibility toggle of a required inherited field", () => {
    render(<CustomFieldsPage projectId="project-1" />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByText("settings:customFields.requiredByWorkspace"),
    ).toBeInTheDocument();
  });

  it("hides an optional inherited field through its toggle", () => {
    render(<CustomFieldsPage projectId="project-1" />);

    const toggle = screen.getAllByRole("switch")[1];
    expect(toggle).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(toggle);

    expect(m.setVisibility).toHaveBeenCalledWith({
      fieldId: "ws-optional",
      hidden: true,
    });
  });

  it("offers edit only on the project's own field", () => {
    render(<CustomFieldsPage projectId="project-1" />);

    const row = screen.getByText("Story points").closest("div.group\\/row");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByRole("button", {
        name: "settings:customFields.actionsAria",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "settings:customFields.actionsAria",
      }),
    ).toHaveLength(1);
  });
});
