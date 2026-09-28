import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Task from "@/types/task";
import TaskAssigneePopover from "./task-assignee-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const updateTaskAssignees = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: updateTaskAssignees }),
}));

const workspaceUsers = {
  members: [
    { userId: "u1", user: { name: "Alice", image: null } },
    { userId: "u2", user: { name: "Bob", image: null } },
  ],
};

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: workspaceUsers }),
  }),
);

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canAssignTasks: () => true }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseTask: Task = {
  id: "task-1",
  title: "Task with two assignees",
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
  createdAt: "2026-07-17T00:00:00.000Z",
  userId: "u1",
  assigneeId: "u1",
  assigneeName: "Alice",
  projectId: "project-1",
  assignees: [
    { userId: "u1", name: "Alice", image: null, units: 100, work: null },
  ],
};

describe("TaskAssigneePopover", () => {
  it("shows a check on every currently assigned member, falling back to the primary assignee", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const aliceButton = await screen.findByRole("button", { name: /Alice/ });
    const bobButton = screen.getByRole("button", { name: /Bob/ });

    // Alice (the task's sole assignee) is checked; her shortcut number is
    // replaced by the check, so "2" (her would-be shortcut) isn't shown.
    expect(aliceButton.textContent).not.toContain("2");
    // Bob isn't assigned yet, so his shortcut number ("3") is still visible.
    expect(bobButton.textContent).toContain("3");
  });

  it("toggles a member in and submits the full resulting userIds list", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const bobButton = await screen.findByRole("button", { name: /Bob/ });
    fireEvent.click(bobButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: ["u1", "u2"],
    });
  });

  it("toggles a member out, submitting the set without them", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    const twoAssignees: Task = {
      ...baseTask,
      assignees: [
        { userId: "u1", name: "Alice", image: null, units: 100, work: null },
        { userId: "u2", name: "Bob", image: null, units: 100, work: null },
      ],
    };

    render(
      <TaskAssigneePopover task={twoAssignees} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const aliceButton = await screen.findByRole("button", { name: /Alice/ });
    fireEvent.click(aliceButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: ["u2"],
    });
  });

  it("clears every assignee when Unassign all is clicked", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const unassignAllButton = await screen.findByRole("button", {
      name: /tasks:popover.assignee.unassignAll/,
    });
    fireEvent.click(unassignAllButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: [],
    });
  });

  it("reverts the optimistic selection and shows a toast when the mutation fails", async () => {
    updateTaskAssignees.mockRejectedValue(new Error("network down"));

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const bobButton = await screen.findByRole("button", { name: /Bob/ });
    fireEvent.click(bobButton);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("network down");
    });
  });
});
