import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Task from "@/types/task";
import TaskConstraintPopover from "./task-constraint-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: () => true }),
}));

vi.mock("@/lib/format", () => ({
  formatDateShort: (date: string) => date,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const task = {
  id: "task-1",
  title: "Constrained task",
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
  constraintType: "finish_no_later_than",
  constraintDate: "2026-07-20T00:00:00.000Z",
} as Task;

describe("TaskConstraintPopover", () => {
  it("lets the popup size to the calendar instead of using a fixed width", async () => {
    render(
      <TaskConstraintPopover task={task}>
        <Button>Constraint</Button>
      </TaskConstraintPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Constraint" }));

    const calendar = await screen.findByRole("grid");
    const popup = calendar.closest('[data-slot="popover-popup"]');
    expect(popup).not.toBeNull();

    const classes = (popup?.className ?? "").split(/\s+/);
    // A fixed width (e.g. w-64) is narrower than the calendar grid and clips
    // the last (Saturday) column; the popup must grow with its content.
    expect(classes).not.toContain("w-64");
    expect(classes).toContain("min-w-64");
  });

  it("keeps the constraint type options usable next to the calendar", async () => {
    render(
      <TaskConstraintPopover task={task}>
        <Button>Constraint</Button>
      </TaskConstraintPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Constraint" }));

    expect(
      await screen.findByRole("button", {
        name: "tasks:popover.constraint.type.must_start_on",
      }),
    ).toBeVisible();
    expect(screen.getByRole("grid")).toBeVisible();
  });
});
