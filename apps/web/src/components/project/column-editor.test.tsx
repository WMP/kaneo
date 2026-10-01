import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ColumnEditor from "./column-editor";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const m = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  createColumn: vi.fn(),
  projectCanUpdate: true,
  enforcement: {
    enforced: false,
    isLoading: false,
    canManageWorkspaceColumns: true,
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: m.toastError },
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateProject: () => m.projectCanUpdate }),
}));
vi.mock("@/hooks/use-project-columns-enforcement", () => ({
  useProjectColumnsEnforcement: () => m.enforcement,
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    isLoading: false,
    data: [
      {
        id: "col-1",
        name: "Backlog",
        slug: "backlog",
        icon: null,
        color: null,
        isFinal: false,
        position: 0,
      },
      {
        id: "col-2",
        name: "Done",
        slug: "done",
        icon: null,
        color: null,
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
  useUpdateColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-delete-column", () => ({
  useDeleteColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-reorder-columns", () => ({
  useReorderColumns: () => ({ mutateAsync: vi.fn() }),
}));

function renderEditor() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ColumnEditor projectId="project-1" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.projectCanUpdate = true;
  m.enforcement = {
    enforced: false,
    isLoading: false,
    canManageWorkspaceColumns: true,
  };
});

describe("project column editor", () => {
  it("is editable when the workspace does not enforce its columns", () => {
    renderEditor();

    expect(
      screen.queryByText("settings:projectWorkflow.enforced.title"),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Backlog")).toBeEnabled();
    expect(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings:columnEditor.deleteAria|Backlog",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings:columnEditor.moveDownAria|Backlog",
      }),
    ).toBeInTheDocument();
  });

  describe("when the workspace enforces its columns", () => {
    beforeEach(() => {
      m.enforcement.enforced = true;
    });

    it("is read-only even for a person who may update the project", () => {
      renderEditor();

      expect(
        screen.getByText("settings:projectWorkflow.enforced.title"),
      ).toBeInTheDocument();
      expect(screen.getByDisplayValue("Backlog")).toBeDisabled();
      expect(screen.getByDisplayValue("Done")).toBeDisabled();
      expect(
        screen.queryByPlaceholderText(
          "settings:columnEditor.newColumnPlaceholder",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "settings:columnEditor.add" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "settings:columnEditor.deleteAria|Backlog",
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "settings:columnEditor.moveDownAria|Backlog",
        }),
      ).not.toBeInTheDocument();
      for (const iconButton of screen.getAllByRole("button", {
        name: "settings:columnEditor.pickIconTitle",
      })) {
        expect(iconButton).toBeDisabled();
      }
      for (const row of screen.getAllByRole("listitem")) {
        expect(row).toHaveAttribute("draggable", "false");
      }
      expect(
        screen.getByRole("switch", {
          name: "settings:columnEditor.markDoneAria|Done",
        }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("links to the workspace workflow page for a person who may manage it", () => {
      renderEditor();

      const link = screen.getByRole("link", {
        name: "settings:projectWorkflow.enforced.manageLink",
      });
      expect(link).toHaveAttribute(
        "href",
        "/dashboard/settings/workspace/workflow",
      );
    });

    it("has no link for a person who may not manage the workspace columns", () => {
      m.enforcement.canManageWorkspaceColumns = false;
      renderEditor();

      expect(
        screen.getByText(
          "settings:projectWorkflow.enforced.descriptionNoAccess",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  it("shows translated copy and refreshes the flag when the API answers 409 enforced", async () => {
    m.createColumn.mockRejectedValue(
      Object.assign(new Error("The workspace enforces its columns."), {
        status: 409,
        code: "WORKSPACE_COLUMNS_ENFORCED",
      }),
    );
    const { invalidate } = renderEditor();

    fireEvent.change(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
      { target: { value: "Review" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:columnEditor.add" }),
    );

    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith(
        "settings:workspaceWorkflow.errors.enforced",
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["workspace-columns"],
    });
    // The typed name stays, so nothing the person wrote is lost.
    expect(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
    ).toHaveValue("Review");
  });

  it("keeps the API message for other errors", async () => {
    m.createColumn.mockRejectedValue(new Error("Column slug already exists"));
    renderEditor();

    fireEvent.change(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
      { target: { value: "Review" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings:columnEditor.add" }),
    );

    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith("Column slug already exists"),
    );
  });
});
