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
  initReactI18next: { type: "3rdParty", init: vi.fn() },
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

  // Approval gates are always milestones, so the badge must render on the
  // diamond branch too (finding 6.3) — not only on the normal bar branch
  // exercised above.
  describe("on a milestone bar", () => {
    it("shows no approval badge when the milestone has no gate", () => {
      render(
        <GanttTaskBar
          task={makeScheduledTask({
            isMilestone: true,
            approvalStatus: "none",
          })}
          timeline={timeline}
          pixelsPerDay={40}
          onOpenTask={vi.fn()}
        />,
      );

      expect(
        screen.queryByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
      ).not.toBeInTheDocument();
    });

    it.each(["pending", "approved", "rejected"] as const)(
      "shows the approval badge for a %s milestone gate",
      (approvalStatus) => {
        render(
          <GanttTaskBar
            task={makeScheduledTask({ isMilestone: true, approvalStatus })}
            timeline={timeline}
            pixelsPerDay={40}
            onOpenTask={vi.fn()}
          />,
        );

        expect(
          screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
        ).toBeInTheDocument();
      },
    );

    it("still renders the milestone diamond alongside the approval badge", () => {
      render(
        <GanttTaskBar
          task={makeScheduledTask({
            isMilestone: true,
            approvalStatus: "approved",
          })}
          timeline={timeline}
          pixelsPerDay={40}
          onOpenTask={vi.fn()}
        />,
      );

      expect(
        screen.getByLabelText(/tasks:gantt.milestoneAriaLabel/),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/tasks:gantt.approvalBadgeAriaLabel/),
      ).toBeInTheDocument();
    });
  });
});

describe("GanttTaskBar drawn width vs hit area", () => {
  function widths() {
    // The drawn bar is the aria-hidden box that carries the title; the hit
    // layer is the transparent parent of the resize/move controls.
    const drawn = screen
      .getByText("Cutover")
      .closest("div[aria-hidden='true']") as HTMLElement;
    const hitLayer = screen.getByLabelText(/tasks:gantt.resizeStart/)
      .parentElement as HTMLElement;
    return {
      drawn: Number.parseFloat(drawn.style.width),
      hit: Number.parseFloat(hitLayer.style.width),
    };
  }

  it("draws a sub-hit-width bar at its true width while the hit area stays >= 20px", () => {
    // A 1-day task at a Month-ish scale (3px/day): the drawn bar collapses to
    // its true (floored) width, well under the 20px hit target — so a 1-, 3-
    // and 5-day task no longer all render as the same 20px pill.
    render(
      <GanttTaskBar
        task={makeScheduledTask()}
        timeline={timeline}
        pixelsPerDay={3}
        onOpenTask={vi.fn()}
      />,
    );

    const { drawn, hit } = widths();
    expect(hit).toBe(20);
    expect(drawn).toBeLessThan(20);
    expect(drawn).toBeGreaterThan(0);
  });

  it("keeps the drawn bar and hit area the same width once the bar is wide", () => {
    // At 40px/day a 1-day bar is already far wider than the 20px minimum, so
    // the hit area matches the drawn bar exactly (no phantom overhang).
    render(
      <GanttTaskBar
        task={makeScheduledTask()}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );

    const { drawn, hit } = widths();
    expect(drawn).toBeGreaterThan(20);
    expect(hit).toBe(drawn);
  });
});

describe("GanttTaskBar barColor", () => {
  function drawnBar() {
    return screen
      .getByText("Cutover")
      .closest("div[aria-hidden='true']") as HTMLElement | null;
  }

  it("uses the default primary-tinted look when no barColor is given", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask()}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
      />,
    );

    const bar = drawnBar();
    expect(bar?.className).toContain("border-primary/25");
    // No inline border color override.
    expect(bar?.style.borderColor).toBe("");
  });

  it("paints the drawn bar's border and tint from barColor instead of the default primary classes", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask()}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        barColor="rgb(16, 185, 129)"
      />,
    );

    const bar = drawnBar();
    expect(bar).not.toBeNull();
    expect(bar?.className).not.toContain("border-primary/25");
    expect(bar?.style.borderColor).toBe("rgb(16, 185, 129)");

    // The static tint overlay is the first child of the drawn bar (progress
    // fill only renders when progress > 0, which this task has none of).
    const tintOverlay = bar?.firstElementChild as HTMLElement;
    expect(tintOverlay.className).not.toContain("bg-primary/12");
    expect(tintOverlay.style.backgroundColor).toContain("color-mix");
    expect(tintOverlay.style.backgroundColor).toContain("rgb(16, 185, 129)");
  });

  it("paints the progress fill from barColor when the task has progress", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ progress: 50 })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        barColor="rgb(16, 185, 129)"
      />,
    );

    const bar = drawnBar();
    const progressFill = bar?.firstElementChild as HTMLElement;
    expect(progressFill.className).not.toContain("bg-primary/30");
    expect(progressFill.style.backgroundColor).toContain("color-mix");
    expect(progressFill.style.backgroundColor).toContain("rgb(16, 185, 129)");
  });

  it("paints the milestone diamond from barColor instead of the default primary classes", () => {
    render(
      <GanttTaskBar
        task={makeScheduledTask({ isMilestone: true })}
        timeline={timeline}
        pixelsPerDay={40}
        onOpenTask={vi.fn()}
        barColor="rgb(16, 185, 129)"
      />,
    );

    const diamondButton = screen.getByLabelText(
      /tasks:gantt.milestoneAriaLabel/,
    );
    expect(diamondButton.className).not.toContain("text-primary");
    expect(diamondButton.style.color).toBe("rgb(16, 185, 129)");

    const diamondIcon = diamondButton.querySelector("svg") as SVGElement;
    expect(diamondIcon.getAttribute("class")).not.toContain("fill-primary/30");
    expect(diamondIcon.style.fill).toContain("color-mix");
    expect(diamondIcon.style.fill).toContain("rgb(16, 185, 129)");
  });
});
