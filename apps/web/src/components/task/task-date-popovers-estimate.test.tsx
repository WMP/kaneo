import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Task from "@/types/task";
import TaskDueDatePopover from "./task-due-date-popover";
import TaskStartDatePopover from "./task-start-date-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-due-date", () => ({
  useUpdateTaskDueDate: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Task",
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
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
}

async function openDue(task: Task) {
  render(
    <TaskDueDatePopover task={task}>
      <Button>Due</Button>
    </TaskDueDatePopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Due" }));
  return screen.findByRole("grid");
}

async function openStart(task: Task) {
  render(
    <TaskStartDatePopover task={task}>
      <Button>Start</Button>
    </TaskStartDatePopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  return screen.findByRole("grid");
}

function enabledDays(grid: HTMLElement) {
  return Array.from(grid.querySelectorAll("button")).filter(
    (button) => !button.hasAttribute("disabled"),
  );
}

const HINT = "tasks:popover.estimate.exclusiveHint";

describe("date popovers and the estimate/date-range rule", () => {
  it("blocks the due date with a hint when the task has an estimate and a start date", async () => {
    const grid = await openDue(
      makeTask({
        estimateMinutes: 480,
        startDate: "2026-07-20T00:00:00.000Z",
      }),
    );

    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(enabledDays(grid)).toHaveLength(0);
  });

  it("blocks the start date with a hint when the task has an estimate and a due date", async () => {
    const grid = await openStart(
      makeTask({
        estimateMinutes: 480,
        dueDate: "2026-07-24T00:00:00.000Z",
      }),
    );

    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(enabledDays(grid)).toHaveLength(0);
  });

  it("leaves a date that is already set editable", async () => {
    const grid = await openDue(
      makeTask({
        estimateMinutes: 480,
        dueDate: "2026-07-24T00:00:00.000Z",
      }),
    );

    expect(screen.queryByText(HINT)).toBeNull();
    expect(enabledDays(grid).length).toBeGreaterThan(0);
  });

  it("leaves both pickers free without an estimate", async () => {
    const grid = await openDue(
      makeTask({ startDate: "2026-07-20T00:00:00.000Z" }),
    );

    expect(screen.queryByText(HINT)).toBeNull();
    expect(enabledDays(grid).length).toBeGreaterThan(0);
  });

  it("leaves the picker free for an estimated task with no dates", async () => {
    const grid = await openStart(makeTask({ estimateMinutes: 480 }));

    expect(screen.queryByText(HINT)).toBeNull();
    expect(enabledDays(grid).length).toBeGreaterThan(0);
  });
});
