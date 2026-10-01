import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { Route } from "./workflow";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));

const m = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissions: { update: true, manageSettings: true },
  getColumns: vi.fn(),
  createColumn: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  reorderColumns: vi.fn(),
  getPreview: vi.fn(),
  setEnforcement: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: m.toastError },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "workspace-1" },
    canUpdateProjects: () => m.permissions.update,
    canManageSettings: () => m.permissions.manageSettings,
  }),
}));
vi.mock("@/fetchers/workspace-column/get-workspace-columns", () => ({
  default: m.getColumns,
}));
vi.mock("@/fetchers/workspace-column/create-workspace-column", () => ({
  default: m.createColumn,
}));
vi.mock("@/fetchers/workspace-column/update-workspace-column", () => ({
  default: m.updateColumn,
}));
vi.mock("@/fetchers/workspace-column/delete-workspace-column", () => ({
  default: m.deleteColumn,
}));
vi.mock("@/fetchers/workspace-column/reorder-workspace-columns", () => ({
  default: m.reorderColumns,
}));
vi.mock("@/fetchers/workspace-column/get-enforcement-preview", () => ({
  default: m.getPreview,
}));
vi.mock("@/fetchers/workspace-column/set-enforcement", () => ({
  default: m.setEnforcement,
}));

const column = (id: string, name: string, position: number) => ({
  id,
  workspaceId: "workspace-1",
  name,
  slug: name.toLowerCase(),
  position,
  icon: null,
  color: null,
  isFinal: false,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
});

const columns = [
  column("col-todo", "Todo", 0),
  column("col-doing", "Doing", 1),
  column("col-done", "Done", 2),
];

const totals = {
  projects: 2,
  projectsChanged: 1,
  columnsCreated: 1,
  columnsRemoved: 1,
  columnsUpdated: 0,
  tasksMoved: 4,
  workflowRulesDeleted: 3,
};

const preview = {
  fallbackColumnId: "col-todo",
  totals,
  projects: [
    {
      projectId: "project-1",
      projectName: "Alpha project",
      changed: true,
      create: [{ workspaceColumnId: "col-done", name: "Done", slug: "done" }],
      remove: [
        {
          columnId: "old",
          name: "Legacy",
          slug: "legacy",
          taskCount: 4,
          workflowRuleCount: 3,
        },
      ],
      update: [],
      tasksMoved: 4,
      workflowRulesDeleted: 3,
    },
    {
      projectId: "project-2",
      projectName: "Already matching",
      changed: false,
      create: [],
      remove: [],
      update: [],
      tasksMoved: 0,
      workflowRulesDeleted: 0,
    },
  ],
};

const Component = Route.options.component as ComponentType;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.permissions.update = true;
  m.permissions.manageSettings = true;
  m.getColumns.mockResolvedValue({ enforced: false, columns });
  m.getPreview.mockResolvedValue(preview);
  m.setEnforcement.mockResolvedValue({
    enforced: true,
    fallbackColumnId: "col-todo",
    totals,
    projects: preview.projects,
  });
  m.deleteColumn.mockResolvedValue(columns[1]);
  m.reorderColumns.mockResolvedValue(columns);
  m.createColumn.mockResolvedValue(columns[0]);
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
});

const enforceSwitch = () =>
  screen.findByRole("switch", {
    name: "settings:workspaceWorkflow.enforcement.switchLabel",
  });

describe("workspace workflow settings", () => {
  it("lists the workspace columns", async () => {
    renderPage();

    expect(await screen.findByDisplayValue("Todo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Doing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Done")).toBeInTheDocument();
  });

  it("shows an error with a retry when the columns cannot be loaded", async () => {
    m.getColumns.mockRejectedValueOnce(new Error("boom"));
    renderPage();

    expect(
      await screen.findByText("settings:workspaceWorkflow.loadError"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "settings:workspaceWorkflow.retry" }),
    );
    expect(await screen.findByDisplayValue("Todo")).toBeInTheDocument();
  });

  it("creates a column in the active workspace", async () => {
    renderPage();
    await screen.findByDisplayValue("Todo");

    fireEvent.change(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
      { target: { value: "Review" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:columnEditor.add" }),
    );

    await waitFor(() =>
      expect(m.createColumn).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        data: { name: "Review", icon: "Circle" },
      }),
    );
  });

  it("moves a column with the keyboard accessible buttons", async () => {
    renderPage();
    await screen.findByDisplayValue("Todo");

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:columnEditor.moveDownAria|Todo",
      }),
    );

    await waitFor(() =>
      expect(m.reorderColumns).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        columns: [
          { id: "col-doing", position: 0 },
          { id: "col-todo", position: 1 },
          { id: "col-done", position: 2 },
        ],
      }),
    );
  });

  describe("enforcement", () => {
    it("disables the switch and explains why when there are no columns", async () => {
      m.getColumns.mockResolvedValue({ enforced: false, columns: [] });
      renderPage();

      const toggle = await enforceSwitch();
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.getByText(
          "settings:workspaceWorkflow.enforcement.noColumnsHint",
        ),
      ).toBeInTheDocument();
    });

    it("disables the switch for a person who cannot manage workspace settings", async () => {
      m.permissions.manageSettings = false;
      renderPage();

      expect(await enforceSwitch()).toHaveAttribute("aria-disabled", "true");
    });

    it("shows the preview, warns about workflow rules and sends the fallback column", async () => {
      renderPage();
      fireEvent.click(await enforceSwitch());

      const dialog = await screen.findByRole("dialog");
      // The first column is the default fallback and the preview asks for it.
      await waitFor(() =>
        expect(m.getPreview).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          fallbackColumnId: "col-todo",
        }),
      );
      expect(await within(dialog).findByText("Alpha project")).toBeVisible();
      expect(
        within(dialog).queryByText("Already matching"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "settings:workspaceWorkflow.enableDialog.rulesWarningTitle",
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          "settings:workspaceWorkflow.enableDialog.rulesDeleted|3",
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          "settings:workspaceWorkflow.enableDialog.tasksMoved|4",
        ),
      ).toBeVisible();

      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.enableDialog.confirm",
        }),
      );

      await waitFor(() =>
        expect(m.setEnforcement).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          enforced: true,
          fallbackColumnId: "col-todo",
        }),
      );
      await waitFor(() =>
        expect(m.toastSuccess).toHaveBeenCalledWith(
          "settings:workspaceWorkflow.enforcement.enabledToast",
        ),
      );
    });

    it("does not enforce before the preview is loaded", async () => {
      m.getPreview.mockReturnValue(new Promise(() => {}));
      renderPage();
      fireEvent.click(await enforceSwitch());

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.enableDialog.confirm",
        }),
      ).toBeDisabled();
      expect(m.setEnforcement).not.toHaveBeenCalled();
    });

    it("shows a translated error and keeps the dialog open when enforcing fails", async () => {
      m.setEnforcement.mockRejectedValue(
        Object.assign(new Error("english"), {
          code: "WORKSPACE_COLUMNS_EMPTY",
        }),
      );
      renderPage();
      fireEvent.click(await enforceSwitch());
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Alpha project");

      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.enableDialog.confirm",
        }),
      );

      await waitFor(() =>
        expect(m.toastError).toHaveBeenCalledWith(
          "settings:workspaceWorkflow.errors.empty",
        ),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("asks for confirmation before turning enforcement off", async () => {
      m.getColumns.mockResolvedValue({ enforced: true, columns });
      renderPage();
      const toggle = await enforceSwitch();
      await waitFor(() => expect(toggle).toBeChecked());

      fireEvent.click(toggle);

      const dialog = await screen.findByRole("alertdialog");
      expect(m.setEnforcement).not.toHaveBeenCalled();
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.disableDialog.confirm",
        }),
      );

      await waitFor(() =>
        expect(m.setEnforcement).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          enforced: false,
        }),
      );
    });
  });

  describe("deleting a column", () => {
    it("deletes without a target when the workspace does not enforce its columns", async () => {
      renderPage();
      await screen.findByDisplayValue("Doing");

      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:columnEditor.deleteAria|Doing",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).queryByText(
          "settings:workspaceWorkflow.deleteDialog.moveTasksTo",
        ),
      ).not.toBeInTheDocument();
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.deleteDialog.confirm",
        }),
      );

      await waitFor(() =>
        expect(m.deleteColumn).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          columnId: "col-doing",
          moveTasksTo: undefined,
        }),
      );
    });

    it("asks where the tasks go when the columns are enforced", async () => {
      m.getColumns.mockResolvedValue({ enforced: true, columns });
      renderPage();
      await screen.findByDisplayValue("Doing");

      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:columnEditor.deleteAria|Doing",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText(
          "settings:workspaceWorkflow.deleteDialog.moveTasksTo",
        ),
      ).toBeVisible();
      // The first other column is preselected.
      expect(within(dialog).getByRole("combobox")).toHaveTextContent("Todo");

      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.deleteDialog.confirm",
        }),
      );

      await waitFor(() =>
        expect(m.deleteColumn).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          columnId: "col-doing",
          moveTasksTo: "col-todo",
        }),
      );
    });

    it("keeps the dialog open with a translated message when the last column is refused", async () => {
      m.getColumns.mockResolvedValue({
        enforced: true,
        columns: [columns[0]],
      });
      m.deleteColumn.mockRejectedValue(
        Object.assign(new Error("english"), { code: "WORKSPACE_COLUMN_LAST" }),
      );
      renderPage();
      await screen.findByDisplayValue("Todo");

      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:columnEditor.deleteAria|Todo",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.deleteDialog.confirm",
        }),
      );

      expect(
        await within(dialog).findByText(
          "settings:workspaceWorkflow.errors.last",
        ),
      ).toBeVisible();
    });

    it("asks for a target when the API reports tasks in the column", async () => {
      m.deleteColumn.mockRejectedValueOnce(
        Object.assign(new Error("english"), {
          code: "WORKSPACE_COLUMN_NOT_EMPTY",
        }),
      );
      renderPage();
      await screen.findByDisplayValue("Doing");

      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:columnEditor.deleteAria|Doing",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.deleteDialog.confirm",
        }),
      );

      expect(
        await within(dialog).findByText(
          "settings:workspaceWorkflow.deleteDialog.moveTasksTo",
        ),
      ).toBeVisible();

      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "settings:workspaceWorkflow.deleteDialog.confirm",
        }),
      );
      await waitFor(() =>
        expect(m.deleteColumn).toHaveBeenLastCalledWith({
          workspaceId: "workspace-1",
          columnId: "col-doing",
          moveTasksTo: "col-todo",
        }),
      );
    });
  });
});
