import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import type { ReactNode } from "react";
import { ColumnList } from "@/components/project/columns/column-list";
import { toast } from "@/lib/toast";

const m = vi.hoisted(() => ({
  canManage: true,
  enforcement: {
    enforced: false,
    isLoading: false,
    canManageWorkspaceColumns: true,
  },
  createColumn: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  reorderColumns: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateProject: () => m.canManage }),
}));
vi.mock("@/hooks/use-project-columns-enforcement", () => ({
  useProjectColumnsEnforcement: () => m.enforcement,
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    isLoading: false,
    data: [
      {
        id: "c1",
        name: "To Do",
        slug: "to-do",
        icon: null,
        isFinal: false,
        position: 0,
      },
      {
        id: "c2",
        name: "Done",
        slug: "done",
        icon: null,
        isFinal: true,
        position: 1,
      },
    ],
  }),
}));
vi.mock("@/hooks/mutations/column/use-create-column", () => ({
  useCreateColumn: () => ({ mutateAsync: m.createColumn }),
}));
vi.mock("@/hooks/mutations/column/use-update-column", () => ({
  useUpdateColumn: () => ({ mutateAsync: m.updateColumn }),
}));
vi.mock("@/hooks/mutations/column/use-delete-column", () => ({
  useDeleteColumn: () => ({ mutateAsync: m.deleteColumn, isPending: false }),
}));
vi.mock("@/hooks/mutations/column/use-reorder-columns", () => ({
  useReorderColumns: () => ({ mutateAsync: m.reorderColumns }),
}));

function renderList() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ColumnList projectId="p1" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("ColumnList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.canManage = true;
    m.enforcement = {
      enforced: false,
      isLoading: false,
      canManageWorkspaceColumns: true,
    };
    for (const fn of [m.createColumn, m.updateColumn, m.deleteColumn]) {
      fn.mockResolvedValue({});
    }
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  });
  afterEach(cleanup);

  it("renames on Enter and reverts a blank name without saving", async () => {
    renderList();
    const [name] = screen.getAllByRole("textbox", {
      name: "settings:columnEditor.renameAria",
    }) as HTMLInputElement[];

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(name.value).toBe("To Do");
    expect(m.updateColumn).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "  Backlog " } });
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(m.updateColumn).toHaveBeenCalledWith({
        id: "c1",
        projectId: "p1",
        data: { name: "Backlog" },
      }),
    );
  });

  it("toggles the done column", async () => {
    renderList();
    const [todoSwitch] = screen.getAllByRole("switch", {
      name: "settings:columnEditor.markDoneAria",
    });
    fireEvent.click(todoSwitch);
    await waitFor(() =>
      expect(m.updateColumn).toHaveBeenCalledWith({
        id: "c1",
        projectId: "p1",
        data: { isFinal: true },
      }),
    );
  });

  it("asks before deleting and keeps the error toast", async () => {
    m.deleteColumn.mockRejectedValue(
      new Error("Cannot delete column that contains tasks."),
    );
    renderList();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "settings:columnEditor.deleteAria",
      })[0],
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText("settings:columnEditor.deleteDescription"),
    ).toBeInTheDocument();
    expect(m.deleteColumn).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirm).getByRole("button", {
        name: "settings:columnEditor.deleteConfirm",
      }),
    );
    await waitFor(() =>
      expect(m.deleteColumn).toHaveBeenCalledWith({
        id: "c1",
        projectId: "p1",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Cannot delete column that contains tasks.",
      ),
    );
  });

  it("adds a column from the inline row", async () => {
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "settings:columnEditor.addColumn" }),
    );
    const input = screen.getByRole("textbox", {
      name: "settings:columnEditor.newColumnPlaceholder",
    });
    fireEvent.change(input, { target: { value: " Review " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(m.createColumn).toHaveBeenCalledWith({
        projectId: "p1",
        data: { name: "Review", icon: "Circle" },
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("is read-only without permission to update the project", () => {
    m.canManage = false;
    renderList();
    expect(
      screen.queryByRole("button", { name: "settings:columnEditor.addColumn" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:columnEditor.deleteAria",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "settings:columnEditor.dragAria" }),
    ).toBeNull();
    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
    }
  });
  describe("when the workspace enforces its columns", () => {
    beforeEach(() => {
      m.enforcement.enforced = true;
    });

    it("is read-only even for a person who may update the project", () => {
      renderList();

      expect(
        screen.getByText("settings:projectWorkflow.enforced.title"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "settings:columnEditor.addColumn",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "settings:columnEditor.deleteAria",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "settings:columnEditor.dragAria",
        }),
      ).toBeNull();
      for (const toggle of screen.getAllByRole("switch")) {
        expect(toggle).toHaveAttribute("aria-disabled", "true");
      }
    });

    it("links to the workspace workflow page for a person who may manage it", () => {
      renderList();

      expect(
        screen.getByRole("link", {
          name: "settings:projectWorkflow.enforced.manageLink",
        }),
      ).toHaveAttribute("href", "/dashboard/settings/workspace/workflow");
    });

    it("has no link for a person who may not manage the workspace columns", () => {
      m.enforcement.canManageWorkspaceColumns = false;
      renderList();

      expect(
        screen.getByText(
          "settings:projectWorkflow.enforced.descriptionNoAccess",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("shows translated copy and refreshes the flag when the API answers 409 enforced", async () => {
    m.createColumn.mockRejectedValue(
      Object.assign(new Error("The workspace enforces its columns."), {
        status: 409,
        code: "WORKSPACE_COLUMNS_ENFORCED",
      }),
    );
    const { invalidate } = renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "settings:columnEditor.addColumn" }),
    );
    const input = screen.getByRole("textbox", {
      name: "settings:columnEditor.newColumnPlaceholder",
    });
    fireEvent.change(input, { target: { value: "Review" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "settings:workspaceWorkflow.errors.enforced",
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["workspace-columns"],
    });
    // The typed name stays, so nothing the person wrote is lost.
    expect(input).toHaveValue("Review");
  });
});
