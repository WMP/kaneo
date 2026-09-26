import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Task from "@/types/task";
import TaskProgressPopover from "./task-progress-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const updateTask = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: updateTask }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task: Task = {
  id: "task-1",
  title: "Directly loaded task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  progress: 20,
  isMilestone: false,
  baselineStartDate: null,
  baselineDueDate: null,
  position: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

describe("TaskProgressPopover", () => {
  it("lets an exact percent be typed and persists it on blur, showing a success toast", async () => {
    updateTask.mockResolvedValue(undefined);

    render(
      <TaskProgressPopover task={task}>
        <Button>Progress</Button>
      </TaskProgressPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));

    const input = await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });
    expect(input).toHaveValue(20);

    fireEvent.change(input, { target: { value: "73" } });
    fireEvent.blur(input);

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1", progress: 73 }),
    );
    await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "tasks:popover.progress.updateSuccess",
    );
  });

  it("commits the typed value on Enter as well as on blur", async () => {
    updateTask.mockResolvedValue(undefined);

    render(
      <TaskProgressPopover task={task}>
        <Button>Progress</Button>
      </TaskProgressPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));
    const input = await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });

    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1", progress: 45 }),
    );
  });

  it("clamps an out-of-range typed value to 0-100", async () => {
    updateTask.mockResolvedValue(undefined);

    render(
      <TaskProgressPopover task={task}>
        <Button>Progress</Button>
      </TaskProgressPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));
    const input = await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });

    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1", progress: 100 }),
    );
  });

  it("shows an error toast and reverts when the update fails", async () => {
    updateTask.mockRejectedValue(new Error("boom"));

    render(
      <TaskProgressPopover task={task}>
        <Button>Progress</Button>
      </TaskProgressPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));
    const input = await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });

    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);

    await screen.findByRole("spinbutton", {
      name: "tasks:popover.progress.exactLabel",
    });
    expect(toastError).toHaveBeenCalledWith("boom");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
