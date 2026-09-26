import { Diamond } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  computeProgressFillPercent,
  getBarGridColumns,
  MIN_BAR_HOVER_HIT_PX,
} from "./timeline";

export type PortfolioBarTask = {
  id: string;
  title: string;
  progress: number;
  isMilestone: boolean;
  scheduleStart: Date;
  scheduleEnd: Date;
};

type GanttPortfolioTaskBarProps = {
  task: PortfolioBarTask;
  timeline: {
    days: Date[];
    rangeStart: Date;
    gridTemplateColumns: string;
  };
  onOpenTask: () => void;
};

// A read-only bar for the portfolio (multi-project) timeline. Reuses the
// same per-day grid math the per-project Gantt's own bars use
// (getBarGridColumns/computeProgressFillPercent from timeline.ts) so a task
// lands at the exact position it would on its own project's Gantt, but with
// none of GanttTaskBar's drag/resize affordances -- the portfolio view is
// click-to-open only for this first version (see AGENTS.md's "follow a
// change through" -- reverse/edit states are deliberately out of scope here).
export function GanttPortfolioTaskBar({
  task,
  timeline,
  onOpenTask,
}: GanttPortfolioTaskBarProps) {
  const { t } = useTranslation();
  const trackCount = timeline.days.length;

  // A milestone renders at its own date rather than whatever
  // scheduleStart/scheduleEnd span it still carries -- same reasoning as
  // GanttTaskBar/GanttExternalTaskBar.
  const { barInView, lineStart, lineEnd } = task.isMilestone
    ? getBarGridColumns(
        task.scheduleStart,
        task.scheduleStart,
        timeline.rangeStart,
        trackCount,
      )
    : getBarGridColumns(
        task.scheduleStart,
        task.scheduleEnd,
        timeline.rangeStart,
        trackCount,
      );

  if (!barInView) return null;

  if (task.isMilestone) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[1] grid items-center"
        style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
      >
        <div
          style={{ gridColumn: `${lineStart} / ${lineEnd}` }}
          className="pointer-events-auto relative flex min-h-[44px] items-center justify-center sm:min-h-0"
        >
          <button
            type="button"
            aria-label={t("portfolio:gantt.milestoneAriaLabel", {
              title: task.title,
            })}
            title={task.title}
            onClick={onOpenTask}
            className="flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-sm text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:size-4"
          >
            <Diamond className="size-full fill-primary/30" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const progressFillPercent = computeProgressFillPercent(
    task.progress,
    task.scheduleStart,
    task.scheduleEnd,
    timeline.rangeStart,
    lineStart,
    lineEnd,
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] grid items-center"
      style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
    >
      <div
        style={{
          gridColumn: `${lineStart} / ${lineEnd}`,
          // See MIN_BAR_HOVER_HIT_PX: keeps a comfortable click target at
          // Month/Quarter regardless of how narrow this track compresses to.
          minWidth: `${MIN_BAR_HOVER_HIT_PX}px`,
        }}
        className="pointer-events-auto relative"
      >
        <button
          type="button"
          onClick={onOpenTask}
          title={task.title}
          aria-label={t("portfolio:gantt.taskAriaLabel", { title: task.title })}
          className={cn(
            "relative mx-1 flex h-8 min-w-0 max-w-[calc(100%-0.5rem)] touch-manipulation items-center overflow-hidden rounded-md border border-primary/25 bg-background px-2 text-left text-xs font-medium leading-none text-foreground shadow-sm transition-colors hover:border-primary/40 sm:h-9",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
        >
          {progressFillPercent > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-primary/30 dark:bg-primary/40"
              style={{ width: `${progressFillPercent}%` }}
            />
          )}
          <span className="relative z-10 block truncate">{task.title}</span>
        </button>
      </div>
    </div>
  );
}
