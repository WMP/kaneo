import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createContext, useContext, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskActionsDropdown from "./task-actions-dropdown";

const duplicateTask = vi.fn();
const canCreateTasks = vi.fn(() => true);
const canDeleteTasks = vi.fn(() => true);
// Hoisted so the vi.mock factories below (which vitest lifts above these
// declarations) can safely reference them.
const { updateTaskStatus, toastSuccess, toastError } = vi.hoisted(() => ({
  updateTaskStatus: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/mutations/task/use-duplicate-task", () => ({
  useDuplicateTask: () => ({ mutate: duplicateTask }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  canCreateTasks.mockReturnValue(true);
  canDeleteTasks.mockReturnValue(true);
  cleanup();
  vi.clearAllMocks();
});

// A minimal, stateful stand-in for the real Base UI Menu (which needs
// pointer-capture APIs jsdom doesn't implement): DropdownMenuContent only
// renders once DropdownMenuTrigger has actually been clicked, so this test
// exercises real open-on-left-click behavior rather than asserting the
// content is merely present in the tree.
const MenuOpenContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = useState(false);
    return (
      <MenuOpenContext.Provider value={{ open, setOpen }}>
        {children}
      </MenuOpenContext.Provider>
    );
  },
  DropdownMenuTrigger: ({
    children,
    onClick,
    onPointerDown,
    onKeyDown,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent) => void;
    onPointerDown?: (event: React.PointerEvent) => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
  }): React.JSX.Element => {
    const ctx = useContext(MenuOpenContext);
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          onClick?.(event);
          ctx?.setOpen(!ctx.open);
        }}
        {...props}
      >
        {children}
      </button>
    );
  },
  DropdownMenuContent: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element | null => {
    const ctx = useContext(MenuOpenContext);
    if (!ctx?.open) return null;
    return <div>{children}</div>;
  },
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: (): React.JSX.Element => <div />,
  DropdownMenuSub: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  DropdownMenuSubContent: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  DropdownMenuSubTrigger: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [],
  }),
}));

vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: () => ({
    data: { members: [] },
  }),
}));

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignee", () => ({
  useUpdateTaskAssignee: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-description", () => ({
  useUpdateTaskDescription: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-due-date", () => ({
  useUpdateTaskDueDate: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: updateTaskStatus }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status-priority", () => ({
  useUpdateTaskPriority: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-title", () => ({
  useUpdateTaskTitle: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({
    canCreateTasks,
    canUpdateTasks: () => true,
    canDeleteTasks,
    canAssignTasks: () => true,
  }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({
    project: {
      columns: [],
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key}|${options.title}` : key,
  }),
}));

const task = {
  id: "task-1",
  title: "Test task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  progress: 0,
  isMilestone: false,
  baselineStartDate: null,
  baselineDueDate: null,
  position: 1,
  createdAt: "2026-08-05T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} as const satisfies Task;

const taskCardContext = {
  projectId: "project-1",
  worskpaceId: "workspace-1",
};

function renderDropdown() {
  render(
    <TaskActionsDropdown
      task={task}
      taskCardContext={taskCardContext}
      onDeleteClick={vi.fn()}
    />,
  );
}

describe("TaskActionsDropdown", () => {
  it("has an accessible label and keeps the actions closed until clicked", () => {
    renderDropdown();

    expect(
      screen.getByRole("button", { name: "tasks:contextMenu.moreActions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("tasks:contextMenu.copyLink"),
    ).not.toBeInTheDocument();
  });

  it("opens the same top-level task actions the context menu exposes, via left click", () => {
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:contextMenu.moreActions" }),
    );

    expect(screen.getByText("tasks:contextMenu.copyLink")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:actions.duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:actions.archive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:actions.delete" }),
    ).toBeInTheDocument();
  });

  it("hides duplicate/delete when the corresponding permission is missing, same as the context menu", () => {
    canCreateTasks.mockReturnValue(false);
    canDeleteTasks.mockReturnValue(false);
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:contextMenu.moreActions" }),
    );

    expect(
      screen.queryByRole("button", { name: "tasks:actions.duplicate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tasks:actions.delete" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("tasks:contextMenu.copyLink")).toBeInTheDocument();
  });

  it("shows only an error toast (never a success toast) when an action's update fails", async () => {
    updateTaskStatus.mockRejectedValueOnce(new Error("boom"));
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:contextMenu.moreActions" }),
    );
    // Archive is a plain item that runs handleChange("status", "archived").
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:actions.archive" }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    // The pre-fix `finally` fired success even on failure — assert it does not.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not let opening the menu bubble a click up to an ancestor (card navigation/drag)", () => {
    const parentClick = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: standing in for the card/row's own click-to-open handler
      // biome-ignore lint/a11y/useKeyWithClickEvents: same — only the click path is under test here
      <div onClick={parentClick}>
        <TaskActionsDropdown
          task={task}
          taskCardContext={taskCardContext}
          onDeleteClick={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:contextMenu.moreActions" }),
    );

    expect(parentClick).not.toHaveBeenCalled();
  });
});
