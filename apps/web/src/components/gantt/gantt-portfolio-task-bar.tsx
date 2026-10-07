import { Diamond } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatEstimate } from "@/lib/estimate";
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
  // True when the task has no dates of its own and its position was derived
  // from its dependency (see gantt-derived-schedule.ts): drawn dotted and
  // dimmer with the derived tooltip, like the per-project Gantt's derived rows.
  isDerived?: boolean;
  estimateMinutes?: number | null;
  estimateUnit?: string;
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

  const isDerived = Boolean(task.isDerived);
  const hasEstimate =
    task.estimateMinutes !== null && task.estimateMinutes !== undefined;
  // A derived row says why it sits where it does; a dated row keeps the plain
  // title. Same keys as the per-project Gantt's own-project derived rows.
  const tooltip = isDerived
    ? t(
        hasEstimate
          ? "tasks:gantt.derivedTaskEstimateTitle"
          : "tasks:gantt.derivedTaskTitle",
        {
          title: task.title,
          ...(hasEstimate
            ? {
                estimate: formatEstimate(
                  task.estimateMinutes as number,
                  task.estimateUnit,
                  t,
                ),
              }
            : {}),
        },
      )
    : task.title;

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
            title={tooltip}
            data-derived={isDerived ? "" : undefined}
            onClick={onOpenTask}
            className={cn(
              "flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-sm text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:size-4",
              isDerived && "opacity-70",
            )}
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
          // The button below fills this whole span (minus its mx-1 inset), so
          // the bar is as wide as its dates, not its text; the dependency
          // overlay measures the same span. See MIN_BAR_HOVER_HIT_PX: keeps a comfortable click target at
          // Month/Quarter regardless of how narrow this track compresses to.
          minWidth: `${MIN_BAR_HOVER_HIT_PX}px`,
        }}
        className="pointer-events-auto relative"
      >
        <button
          type="button"
          onClick={onOpenTask}
          title={tooltip}
          data-derived={isDerived ? "" : undefined}
          aria-label={t("portfolio:gantt.taskAriaLabel", { title: task.title })}
          className={cn(
            "relative mx-1 flex h-8 w-[calc(100%-0.5rem)] min-w-0 touch-manipulation items-center overflow-hidden rounded-md border border-primary/25 bg-background px-2 text-left text-xs font-medium leading-none text-foreground shadow-sm transition-colors hover:border-primary/40 sm:h-9",
            // Display-only derived row: dotted and a touch fainter, like the
            // project Gantt's derived bar, so it never reads as a dated one.
            isDerived &&
              "border-dotted border-muted-foreground/40 bg-muted/40 text-muted-foreground opacity-80",
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
