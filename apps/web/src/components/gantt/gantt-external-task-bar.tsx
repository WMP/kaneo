import { Diamond } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatEstimate } from "@/lib/estimate";
import type { GanttBarEmphasis } from "./timeline";
import { getBarGridColumns, MIN_BAR_HOVER_HIT_PX } from "./timeline";

export type ExternalGanttTask = {
  id: string;
  title: string;
  number: number | null;
  projectName: string;
  projectSlug: string;
  scheduleStart: Date;
  scheduleEnd: Date;
  isMilestone: boolean;
  // True when this row has no dates of its own and its position was DERIVED
  // from a "blocks" dependency (see gantt-derived-schedule.ts) — drawn with a
  // dotted, dimmer treatment and a distinct tooltip so it never reads as a
  // real, dated bar.
  isDerived?: boolean;
  // True for a task of the project on screen that has no dates of its own and
  // is drawn from its dependency (and estimate) like a derived cross-project
  // row. It stays read-only on the chart, but its rail entry opens the task.
  isOwnProject?: boolean;
  // The id of the project the task belongs to (this project's own id for an
  // own row); used to open a cross-project task in its own project.
  projectId?: string;
  // The task's status slug from its relation summary, shown in the rail the
  // same way an own row shows it. Optional so older callers still compile.
  status?: string;
  // The task's effort estimate in minutes (null/undefined = none) and the unit
  // it was entered in: a derived row's length comes from it, and the tooltip
  // shows it.
  estimateMinutes?: number | null;
  estimateUnit?: string;
};

type GanttExternalTaskBarProps = {
  task: ExternalGanttTask;
  timeline: {
    days: Date[];
    rangeStart: Date;
    gridTemplateColumns: string;
  };
  emphasis?: GanttBarEmphasis;
  /** Whether this cross-project task sits on the currently-highlighted
   * critical path (see gantt-critical-path.ts and GanttTaskBar's own
   * isCritical prop) — a dated cross-project "blocks" dependency
   * participates in the same CPM network as an own task, so it can come out
   * critical too. */
  isCritical?: boolean;
  /** Notified on hover/focus, same as GanttTaskBar, so hovering an external
   * bar highlights its dependency lines too. */
  onHoverChange?: (hovering: boolean) => void;
  /** Opens the task. The bar stays read-only (no drag or resize); this only
   * makes it keyboard- and click-activatable like a normal bar. Omitted: the
   * bar is not interactive. */
  onOpenTask?: () => void;
};

const OPEN_BUTTON_CLASS =
  "absolute inset-0 z-10 cursor-pointer touch-manipulation rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

function getTooltipKey(task: ExternalGanttTask, hasEstimate: boolean) {
  if (!task.isDerived) return "tasks:gantt.externalTaskTitle";
  if (task.isOwnProject) {
    return hasEstimate
      ? "tasks:gantt.derivedTaskEstimateTitle"
      : "tasks:gantt.derivedTaskTitle";
  }
  return hasEstimate
    ? "tasks:gantt.externalTaskDerivedEstimateTitle"
    : "tasks:gantt.externalTaskDerivedTitle";
}

// A read-only row: a related task of another project, or an own task drawn
// from its dependency. It is shown so its dependency line has somewhere to
// land and is never draggable/resizable; when `onOpenTask` is given, an
// overlaid button opens the task like a normal bar does.
export function GanttExternalTaskBar({
  task,
  timeline,
  emphasis = "normal",
  isCritical = false,
  onHoverChange,
  onOpenTask,
}: GanttExternalTaskBarProps) {
  const { t } = useTranslation();
  const trackCount = timeline.days.length;
  // A milestone renders at its own date rather than whatever span
  // scheduleStart/scheduleEnd resolved to — see the matching comment in
  // GanttTaskBar.
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

  const hasEstimate =
    task.estimateMinutes !== null && task.estimateMinutes !== undefined;
  const ariaLabel = t("tasks:gantt.externalTaskAriaLabel", {
    title: task.title,
  });
  const title = t(getTooltipKey(task, hasEstimate), {
    title: task.title,
    projectName: task.projectName,
    ...(hasEstimate
      ? {
          estimate: formatEstimate(
            task.estimateMinutes as number,
            task.estimateUnit,
            t,
          ),
        }
      : {}),
  });

  if (task.isMilestone) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[1] grid items-center"
        style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus tracking drives dependency-line highlighting, matching GanttTaskBar; activation lives on the inner button. */}
        <div
          data-gantt-external-bar=""
          style={{ gridColumn: `${lineStart} / ${lineEnd}` }}
          onMouseEnter={() => onHoverChange?.(true)}
          onMouseLeave={() => onHoverChange?.(false)}
          onFocus={() => onHoverChange?.(true)}
          onBlur={() => onHoverChange?.(false)}
          className={cn(
            "pointer-events-auto relative flex min-h-[44px] items-center justify-center sm:min-h-0",
            onOpenTask ? "cursor-pointer" : "cursor-default",
          )}
          title={title}
        >
          {onOpenTask ? (
            <button
              type="button"
              aria-label={ariaLabel}
              onClick={onOpenTask}
              className={OPEN_BUTTON_CLASS}
            />
          ) : null}
          <Diamond
            className={cn(
              "size-4 shrink-0 fill-muted-foreground/20 text-muted-foreground/70",
              emphasis === "highlighted" && "ring-2 ring-primary/30",
              emphasis === "dimmed" && "opacity-35",
              // A derived (dateless) marker reads fainter than a real dated one.
              task.isDerived && emphasis !== "dimmed" && "opacity-70",
              // Critical-path accent (see GanttTaskBar's own isCritical prop
              // for why this is `outline`, not a color swap).
              isCritical &&
                "outline outline-2 outline-offset-2 outline-warning",
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] grid items-center"
      style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus tracking drives dependency-line highlighting, matching GanttTaskBar; activation lives on the inner button. */}
      <div
        data-gantt-external-bar=""
        style={{
          gridColumn: `${lineStart} / ${lineEnd}`,
          // See MIN_BAR_HOVER_HIT_PX: guarantees a comfortable hover/pointer
          // footprint at Month/Quarter regardless of how narrow this row's
          // own date-range track compresses to.
          minWidth: `${MIN_BAR_HOVER_HIT_PX}px`,
        }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
        className={cn(
          "pointer-events-auto relative mx-1 flex min-h-[44px] min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-muted-foreground/40 bg-muted/40 px-2 text-left text-sm font-medium leading-none text-muted-foreground shadow-sm transition-opacity sm:h-11 sm:min-h-0",
          onOpenTask ? "cursor-pointer" : "cursor-default",
          // A dated cross-project bar is dashed; a derived (dateless) one is
          // dotted and a touch fainter, so the two never read alike.
          task.isDerived ? "border-dotted" : "border-dashed",
          task.isDerived && emphasis !== "dimmed" && "opacity-80",
          emphasis === "highlighted" &&
            "border-primary/50 ring-2 ring-primary/30",
          emphasis === "dimmed" && "opacity-35",
          // Critical-path accent (see GanttTaskBar's own isCritical prop for
          // why this is `outline`, not a color swap).
          isCritical && "outline outline-2 outline-offset-2 outline-warning",
        )}
        title={title}
      >
        {onOpenTask ? (
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={onOpenTask}
            className={OPEN_BUTTON_CLASS}
          />
        ) : null}
        <span className="shrink-0 truncate rounded-full bg-secondary/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
          {task.projectSlug}
          {task.number ? `-${task.number}` : ""}
        </span>
        <span className="truncate">{task.title}</span>
      </div>
    </div>
  );
}
