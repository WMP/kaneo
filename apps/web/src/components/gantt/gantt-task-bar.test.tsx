import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalGate } from "@/hooks/queries/task-relation/use-gantt-gate-warnings";
import type Task from "@/types/task";
import { GanttTaskBar } from "./gantt-task-bar";

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

afterEach(() => {
  cleanup();
});

const rangeStart = new Date(2026, 0, 1);
const days = Array.from({ length: 5 }, (_, index) => {
  const date = new Date(rangeStart);
  date.setDate(date.getDate() + index);
  return date;
});
const timeline = {
  days,
  rangeStart,
  gridTemplateColumns: "repeat(5, 1fr)",
};

function makeScheduledTask(overrides: Partial<Task> = {}) {
  const base: Task = {
    id: "task-1",
    title: "Cutover",
    number: 1,
    description: null,
    status: "to-do",
    priority: "medium",
    startDate: "2026-01-02T00:00:00.000Z",
    dueDate: "2026-01-03T00:00:00.000Z",
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
  return {
    ...base,
    scheduleStart: new Date(2026, 0, 2),
    scheduleEnd: new Date(2026, 0, 3),
  };
}

const gate: ApprovalGate = {
  taskId: "gate-task",
  title: "Client sign-off",
  approvalStatus: "pending",
};

describe("GanttTaskBar approval badge and gate warning", () => {
  it("shows no approval badge when the task has no gate", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "none" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );

    expect(
      screen.queryByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).not.toBeInTheDocument();
  });

  it("shows a distinct approval badge for a pending gate", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "pending" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).toBeInTheDocument();
  });

  it("shows the approval badge for approved and rejected gates too", () => {
    const { rerender } = render(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "approved" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).toBeInTheDocument();

    rerender(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "rejected" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).toBeInTheDocument();
  });

  it("renders no gate-warning marker when nothing blocks the task", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask()}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        gateWarnings={[]}
      />,
    );

    expect(
      screen.queryByLabelText(/tasks:gantt.gateWarningAriaLabel/),
    ).not.toBeInTheDocument();
  });

  it("renders a gate-warning marker distinct from the approval badge when blocked", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "none" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        gateWarnings={[gate]}
      />,
    );

    expect(
      screen.getByLabelText(/tasks:gantt.gateWarningAriaLabel/),
    ).toBeInTheDocument();
    // The task itself has no approval gate of its own ("none"), only an
    // upstream one blocking it, so the two markers are independent.
    expect(
      screen.queryByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).not.toBeInTheDocument();
  });

  it("can show both a gate warning and the task's own approval badge together", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ approvalStatus: "pending" })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        gateWarnings={[gate]}
      />,
    );

    expect(
      screen.getByLabelText(/tasks:gantt.gateWarningAriaLabel/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
    ).toBeInTheDocument();
  });
});
