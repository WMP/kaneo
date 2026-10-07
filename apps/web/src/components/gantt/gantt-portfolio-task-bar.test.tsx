import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GanttPortfolioTaskBar } from "./gantt-portfolio-task-bar";
import { buildGanttGridMetrics, buildGanttRange } from "./timeline";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

afterEach(() => cleanup());

function buildTimeline() {
  const range = buildGanttRange(
    [
      {
        scheduleStart: new Date("2026-01-05"),
        scheduleEnd: new Date("2026-01-15"),
      },
    ],
    1,
  );
  if (!range) throw new Error("expected a range");
  const metrics = buildGanttGridMetrics(range.days.length, 2.75);
  return { ...range, ...metrics };
}

describe("GanttPortfolioTaskBar", () => {
  it("renders a normal task's title and calls onOpenTask when clicked", () => {
    const timeline = buildTimeline();
    const onOpenTask = vi.fn();
    render(
      <GanttPortfolioTaskBar
        task={{
          id: "task-1",
          title: "Migrate schema",
          progress: 50,
          isMilestone: false,
          scheduleStart: new Date("2026-01-05"),
          scheduleEnd: new Date("2026-01-08"),
        }}
        timeline={timeline}
        onOpenTask={onOpenTask}
      />,
    );

    const button = screen.getByText("Migrate schema").closest("button");
    expect(button).not.toBeNull();
    if (button) fireEvent.click(button);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("renders a milestone as a diamond and calls onOpenTask when clicked", () => {
    const timeline = buildTimeline();
    const onOpenTask = vi.fn();
    render(
      <GanttPortfolioTaskBar
        task={{
          id: "task-2",
          title: "Ship v1",
          progress: 0,
          isMilestone: true,
          scheduleStart: new Date("2026-01-10"),
          scheduleEnd: new Date("2026-01-10"),
        }}
        timeline={timeline}
        onOpenTask={onOpenTask}
      />,
    );

    const button = screen.getByRole("button", {
      name: 'portfolio:gantt.milestoneAriaLabel:{"title":"Ship v1"}',
    });
    fireEvent.click(button);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a task entirely outside the visible window", () => {
    const timeline = buildTimeline();
    const { container } = render(
      <GanttPortfolioTaskBar
        task={{
          id: "task-3",
          title: "Far future",
          progress: 0,
          isMilestone: false,
          scheduleStart: new Date("2030-01-01"),
          scheduleEnd: new Date("2030-01-02"),
        }}
        timeline={timeline}
        onOpenTask={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("draws a derived task dotted with the derived tooltip, still opening on click", () => {
    const timeline = buildTimeline();
    const onOpenTask = vi.fn();
    render(
      <GanttPortfolioTaskBar
        task={{
          id: "task-4",
          title: "Cutover",
          progress: 0,
          isMilestone: false,
          scheduleStart: new Date("2026-01-08"),
          scheduleEnd: new Date("2026-01-09"),
          isDerived: true,
          estimateMinutes: 960,
          estimateUnit: "hours",
        }}
        timeline={timeline}
        onOpenTask={onOpenTask}
      />,
    );

    const button = screen.getByText("Cutover").closest("button");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("data-derived")).toBe(true);
    expect(button?.className).toContain("border-dotted");
    expect(button?.getAttribute("title")).toContain(
      "tasks:gantt.derivedTaskEstimateTitle",
    );
    if (button) fireEvent.click(button);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("uses the no-estimate derived tooltip and keeps a dated bar's plain title", () => {
    const timeline = buildTimeline();
    const { rerender } = render(
      <GanttPortfolioTaskBar
        task={{
          id: "task-5",
          title: "Marker",
          progress: 0,
          isMilestone: false,
          scheduleStart: new Date("2026-01-08"),
          scheduleEnd: new Date("2026-01-08"),
          isDerived: true,
          estimateMinutes: null,
        }}
        timeline={timeline}
        onOpenTask={vi.fn()}
      />,
    );
    expect(screen.getByText("Marker").closest("button")?.title).toContain(
      "tasks:gantt.derivedTaskTitle",
    );

    rerender(
      <GanttPortfolioTaskBar
        task={{
          id: "task-5",
          title: "Marker",
          progress: 0,
          isMilestone: false,
          scheduleStart: new Date("2026-01-08"),
          scheduleEnd: new Date("2026-01-08"),
        }}
        timeline={timeline}
        onOpenTask={vi.fn()}
      />,
    );
    const plain = screen.getByText("Marker").closest("button");
    expect(plain?.title).toBe("Marker");
    expect(plain?.hasAttribute("data-derived")).toBe(false);
    expect(plain?.className).not.toContain("border-dotted");
  });
});
