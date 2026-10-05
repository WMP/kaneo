import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { GanttTaskBar } from "./gantt-task-bar";

const updateTask = vi.fn(async (_task: unknown) => undefined);

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: updateTask }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// 2026-01-01 is a Thursday.
const rangeStart = new Date(2026, 0, 1);
const days = Array.from({ length: 10 }, (_, index) => {
  const date = new Date(rangeStart);
  date.setDate(date.getDate() + index);
  return date;
});
const timeline = {
  days,
  rangeStart,
  gridTemplateColumns: "repeat(10, 1fr)",
};
const PX_PER_DAY = 40;
const MON_FRI = (date: Date) => date.getDay() >= 1 && date.getDay() <= 5;

function makeTask(
  overrides: Partial<Task>,
  scheduleStart: Date,
  scheduleEnd: Date,
) {
  const base: Task = {
    id: "task-1",
    title: "Estimated",
    number: 1,
    description: null,
    status: "to-do",
    priority: "medium",
    startDate: null,
    dueDate: null,
    progress: 0,
    isMilestone: false,
    baselineStartDate: null,
    baselineDueDate: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
  return { ...base, scheduleStart, scheduleEnd };
}

function renderBar(task: ReturnType<typeof makeTask>) {
  render(
    <GanttTaskBar
      task={task}
      timeline={timeline}
      pixelsPerDay={PX_PER_DAY}
      onOpenTask={vi.fn()}
      isWorkingDay={MON_FRI}
    />,
  );
}

function dragBar(deltaDays: number) {
  const bar = screen.getByLabelText(/tasks:gantt.taskAriaLabel/);
  fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: 100 + deltaDays * PX_PER_DAY,
  });
  fireEvent.pointerUp(window, {
    pointerId: 1,
    clientX: 100 + deltaDays * PX_PER_DAY,
  });
}

function sentDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

describe("GanttTaskBar for an estimated task with one own date", () => {
  it("hides the resize handles, which would create the missing date", () => {
    // Start Fri Jan 2, 2 days => Fri-Mon.
    renderBar(
      makeTask(
        {
          startDate: "2026-01-02T00:00:00.000Z",
          estimateMinutes: 960,
          estimateUnit: "days",
        },
        new Date(2026, 0, 2),
        new Date(2026, 0, 5),
      ),
    );

    expect(screen.queryByLabelText("tasks:gantt.resizeStart")).toBeNull();
    expect(screen.queryByLabelText("tasks:gantt.resizeDue")).toBeNull();
    expect(
      screen.getByLabelText(/tasks:gantt.taskAriaLabel/),
    ).toBeInTheDocument();
  });

  it("keeps the resize handles for a task without an estimate", () => {
    renderBar(
      makeTask(
        { startDate: "2026-01-02T00:00:00.000Z" },
        new Date(2026, 0, 2),
        new Date(2026, 0, 2),
      ),
    );

    expect(
      screen.getByLabelText("tasks:gantt.resizeStart"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("tasks:gantt.resizeDue")).toBeInTheDocument();
  });

  it("dragging a start-only bar saves only the start date", () => {
    renderBar(
      makeTask(
        {
          startDate: "2026-01-02T00:00:00.000Z",
          estimateMinutes: 960,
          estimateUnit: "days",
        },
        new Date(2026, 0, 2),
        new Date(2026, 0, 5),
      ),
    );

    // +3 days: Fri Jan 2 -> Mon Jan 5; the derived end (Tue Jan 6) is not sent.
    dragBar(3);

    expect(updateTask).toHaveBeenCalledTimes(1);
    const sent = updateTask.mock.calls[0]?.[0] as {
      startDate: string | null;
      dueDate: string | null;
      estimateMinutes: number;
    };
    expect(sentDay(sent.startDate)).toBe("2026-1-5");
    expect(sent.dueDate).toBeNull();
    expect(sent.estimateMinutes).toBe(960);
  });

  it("dragging a due-only bar saves only the due date", () => {
    // Due Fri Jan 9, 2 days => Thu Jan 8 - Fri Jan 9.
    renderBar(
      makeTask(
        {
          dueDate: "2026-01-09T00:00:00.000Z",
          estimateMinutes: 960,
          estimateUnit: "days",
        },
        new Date(2026, 0, 8),
        new Date(2026, 0, 9),
      ),
    );

    // -3 days: due Fri Jan 9 -> Tue Jan 6; the derived start is not sent.
    dragBar(-3);

    expect(updateTask).toHaveBeenCalledTimes(1);
    const sent = updateTask.mock.calls[0]?.[0] as {
      startDate: string | null;
      dueDate: string | null;
    };
    expect(sent.startDate).toBeNull();
    expect(sentDay(sent.dueDate)).toBe("2026-1-6");
  });

  it("still saves both dates when a task without an estimate is dragged", () => {
    renderBar(
      makeTask(
        {
          startDate: "2026-01-02T00:00:00.000Z",
          dueDate: "2026-01-03T00:00:00.000Z",
        },
        new Date(2026, 0, 2),
        new Date(2026, 0, 3),
      ),
    );

    dragBar(2);

    const sent = updateTask.mock.calls[0]?.[0] as {
      startDate: string;
      dueDate: string;
    };
    expect(sentDay(sent.startDate)).toBe("2026-1-4");
    expect(sentDay(sent.dueDate)).toBe("2026-1-5");
  });
});
