import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, isToday } from "date-fns";
import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Loader2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import {
  buildDependencyEdges,
  DEPENDENCY_LANE_CLEARANCE_PX,
  type TaskBarBox,
} from "@/components/gantt/dependency-lines";
import { GanttDependencyOverlay } from "@/components/gantt/gantt-dependency-overlay";
import {
  buildPortfolioDependencyEdges,
  buildPortfolioRows,
  flattenPortfolioSchedule,
} from "@/components/gantt/gantt-portfolio";
import { GanttPortfolioTaskBar } from "@/components/gantt/gantt-portfolio-task-bar";
import { GanttSummaryTaskBar } from "@/components/gantt/gantt-summary-task-bar";
import {
  buildHolidayDateKeySet,
  DEFAULT_WORKING_DAYS,
  isWorkingDay,
} from "@/components/gantt/gantt-working-calendar";
import {
  buildGanttGridMetrics,
  buildGanttHeaderColumns,
  buildGanttRange,
  canMoveGanttWindowStart,
  computeInsetBarBox,
  GANTT_UNITS,
  type GanttUnit,
  getBarEdgeInsetPx,
  getBarGridColumns,
  getRootFontSizePx,
  MIN_BAR_HOVER_HIT_PX,
  parseTaskDate,
  pickDefaultGanttUnit,
} from "@/components/gantt/timeline";
import { useTimelinePanZoom } from "@/components/gantt/use-timeline-pan-zoom";
import PageTitle from "@/components/page-title";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import icons from "@/constants/project-icons";
import useGetCalendar from "@/hooks/queries/calendar/use-get-calendar";
import useGetPortfolio from "@/hooks/queries/project/use-get-portfolio";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/cn";
import { useUserPreferencesStore } from "@/store/user-preferences";

// Static i18n keys (never built from `unit`), matching the per-project
// Gantt's own segmented-control convention.
const GANTT_UNIT_LABEL_KEYS: Record<GanttUnit, string> = {
  day: "tasks:gantt.unitDay",
  week: "tasks:gantt.unitWeek",
  month: "tasks:gantt.unitMonth",
  quarter: "tasks:gantt.unitQuarter",
};

// Base day-column width per unit, in rem -- same values the per-project
// Gantt uses for its own unzoomed columns (see UNIT_BASE_DAY_COLUMN_WIDTH_REM
// in that route), reused here since the portfolio timeline shares the same
// per-day grid math. The unit switch remains the coarse lever; useTimelinePanZoom's
// zoom factor (see below) is the fine, wheel-driven adjustment on top of it,
// same split as the per-project Gantt.
const UNIT_DAY_COLUMN_WIDTH_REM: Record<
  GanttUnit,
  { desktop: number; mobile: number }
> = {
  day: { desktop: 2.75, mobile: 3.125 },
  week: { desktop: 0.82, mobile: 0.92 },
  month: { desktop: 0.185, mobile: 0.22 },
  quarter: { desktop: 0.076, mobile: 0.09 },
};

const RAIL_WIDTH_REM = { desktop: 16, mobile: 11 };

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/portfolio",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const periodStartHintId = useId();
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetPortfolio({ workspaceId });
  const projects = useMemo(() => data?.projects ?? [], [data]);

  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const ganttUnit = useUserPreferencesStore((state) => state.ganttTimelineUnit);
  const hasTouchedGanttUnit = useUserPreferencesStore(
    (state) => state.ganttTimelineUnitTouched,
  );
  const setGanttUnit = useUserPreferencesStore(
    (state) => state.setGanttTimelineUnit,
  );

  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [requestedStart, setRequestedStart] = useState<Date | null>(null);
  const [selectedTask, setSelectedTask] = useState<{
    taskId: string;
    projectId: string;
  } | null>(null);

  // Workspace working calendar, the same predicate the per-project Gantt
  // feeds its derivations (Mon-Fri until the query resolves), so an estimated
  // task and a derived successor land on the same days in both views.
  const { data: calendar } = useGetCalendar(workspaceId);
  const workingDays = calendar?.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidayDateSet = useMemo(
    () => buildHolidayDateKeySet(calendar?.holidays ?? []),
    [calendar?.holidays],
  );
  const workingDayPredicate = useCallback(
    (date: Date) => isWorkingDay(date, workingDays, holidayDateSet),
    [workingDays, holidayDateSet],
  );

  // One pass over the whole payload: dated spans (estimate-sized when a task
  // has one own date), then display-only positions for dateless `blocks`
  // successors (gantt-portfolio.ts reuses the project Gantt's derivation).
  const rows = useMemo(
    () =>
      buildPortfolioRows(projects, {
        derivationDependencies: data?.undatedSuccessorDependencies,
        isWorkingDay: workingDayPredicate,
      }),
    [projects, data?.undatedSuccessorDependencies, workingDayPredicate],
  );
  const flatSchedule = useMemo(() => flattenPortfolioSchedule(rows), [rows]);

  // Cross-project dependency lines (see dependency-lines.ts/
  // gantt-dependency-overlay.tsx, the same overlay the per-project Gantt
  // uses): the portfolio endpoint only ever returns "blocks" relations whose
  // two tasks sit in different projects, so every one of these connects two
  // different rows below.
  const dependencyEdges = useMemo(
    () => buildPortfolioDependencyEdges(data?.dependencies ?? []),
    [data],
  );

  // First-open default unit, same reasoning as the per-project Gantt: pick
  // whichever unit would show the whole portfolio's span without opening
  // cramped or needlessly zoomed out. A viewer's persisted choice always
  // wins once they've touched the control (shared with the per-project
  // Gantt's own preference).
  const overallSpanDays = useMemo(() => {
    if (flatSchedule.length === 0) return null;
    let start = flatSchedule[0].scheduleStart;
    let end = flatSchedule[0].scheduleEnd;
    for (const task of flatSchedule) {
      if (task.scheduleStart < start) start = task.scheduleStart;
      if (task.scheduleEnd > end) end = task.scheduleEnd;
    }
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  }, [flatSchedule]);

  // First-open default: cap the span-based auto-pick at Month. A whole-year
  // portfolio otherwise opens in Quarter, where every task collapses to the
  // same minimum-width pill and the view reads as useless until the user
  // switches scale; Month keeps bar lengths legible on a yearly plan. A
  // viewer's explicit choice still wins once they've touched the control.
  const effectiveGanttUnit = hasTouchedGanttUnit
    ? ganttUnit
    : ((): GanttUnit => {
        const auto = pickDefaultGanttUnit(overallSpanDays);
        return auto === "quarter" ? "month" : auto;
      })();

  const range = useMemo(
    () =>
      buildGanttRange(
        flatSchedule,
        weekStartsOn,
        requestedStart,
        new Date(),
        effectiveGanttUnit,
      ),
    [flatSchedule, weekStartsOn, requestedStart, effectiveGanttUnit],
  );

  const baseDayColumnWidthRem = isMobile
    ? UNIT_DAY_COLUMN_WIDTH_REM[effectiveGanttUnit].mobile
    : UNIT_DAY_COLUMN_WIDTH_REM[effectiveGanttUnit].desktop;
  const railWidthRem = isMobile
    ? RAIL_WIDTH_REM.mobile
    : RAIL_WIDTH_REM.desktop;

  // Horizontal drag-to-pan, wheel/trackpad panning, and ctrl/cmd-wheel zoom
  // anchored under the cursor -- the same interaction model as the
  // per-project Gantt (see useTimelinePanZoom), layered as a fine adjustment
  // on top of the coarse unit switch above. The listener only needs to be
  // live once the real timeline (rather than one of the loading/empty
  // states below) is actually on screen, hence `enabled`.
  const {
    viewportRef,
    zoom,
    setZoom,
    isPanning,
    onPointerDown: onTimelinePointerDown,
    onPointerMove: onTimelinePointerMove,
    onPointerUp: onTimelinePointerUp,
    onPointerCancel: onTimelinePointerCancel,
  } = useTimelinePanZoom({
    getRailWidthPx: () => railWidthRem * getRootFontSizePx(),
    enabled: Boolean(range) && flatSchedule.length > 0,
  });
  const dayColumnWidthRem = baseDayColumnWidthRem * zoom;

  const handleUnitChange = (unit: GanttUnit) => {
    setGanttUnit(unit);
    setRequestedStart(null);
    setZoom(1);
  };

  const gridMetrics = useMemo(
    () =>
      range
        ? buildGanttGridMetrics(range.days.length, dayColumnWidthRem)
        : null,
    [range, dayColumnWidthRem],
  );

  const headerColumns = useMemo(
    () =>
      range
        ? buildGanttHeaderColumns(range.days, effectiveGanttUnit, weekStartsOn)
        : [],
    [range, effectiveGanttUnit, weekStartsOn],
  );

  const timeline = useMemo(
    () =>
      range && gridMetrics
        ? {
            days: range.days,
            rangeStart: range.rangeStart,
            gridTemplateColumns: gridMetrics.gridTemplateColumns,
          }
        : null,
    [range, gridMetrics],
  );

  // Pixel geometry for the dependency-line overlay -- mirrors the per-project
  // Gantt's own taskBoxes derivation (see gantt.tsx), but measures each
  // task row's vertical position straight from the DOM (via
  // taskRowElementsRef) instead of a row virtualizer's offsets, since this
  // view renders every row unvirtualized. A task whose row isn't mounted
  // (its project is collapsed, or the task falls outside the visible date
  // window) simply has no box here, and buildDependencyEdges below skips any
  // edge missing either endpoint's box -- same "no box, no line" rule the
  // per-project Gantt already relies on.
  const rowsContainerRef = useRef<HTMLDivElement>(null);
  const taskRowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const [taskBoxes, setTaskBoxes] = useState<Map<string, TaskBarBox>>(
    () => new Map(),
  );

  const measureTaskBoxes = useCallback(() => {
    if (!timeline) {
      setTaskBoxes(new Map());
      return;
    }
    const trackCount = timeline.days.length;
    const pixelsPerDay = dayColumnWidthRem * getRootFontSizePx();
    const railWidthPx = railWidthRem * getRootFontSizePx();
    const edgeInsetPx = getBarEdgeInsetPx();
    const boxes = new Map<string, TaskBarBox>();

    for (const row of rows) {
      if (collapsedProjectIds.has(row.id)) continue;
      for (const task of row.tasks) {
        const element = taskRowElementsRef.current.get(task.id);
        if (!element) continue;
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
        if (!barInView) continue;
        const box = computeInsetBarBox(
          railWidthPx + (lineStart - 1) * pixelsPerDay,
          railWidthPx + (lineEnd - 1) * pixelsPerDay,
          edgeInsetPx,
        );
        const hoverWidth = box.right - box.left;
        const hoverGrow = Math.max(0, MIN_BAR_HOVER_HIT_PX - hoverWidth) / 2;
        boxes.set(task.id, {
          left: box.left - hoverGrow,
          right: box.right + hoverGrow,
          top: element.offsetTop,
          height: element.offsetHeight,
        });
      }
    }
    setTaskBoxes(boxes);
  }, [rows, collapsedProjectIds, timeline, dayColumnWidthRem, railWidthRem]);

  useLayoutEffect(() => {
    measureTaskBoxes();
  }, [measureTaskBoxes]);

  // Catches a row resizing (e.g. text wrapping differently) without the
  // mounted row set itself changing, same reasoning as the per-project
  // Gantt's own row ResizeObserver.
  useEffect(() => {
    const container = rowsContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measureTaskBoxes());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureTaskBoxes]);

  // Which project each task belongs to: editing a dependency needs the
  // permission in the source task's own project.
  const projectIdByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      for (const task of project.tasks) map.set(task.id, project.id);
    }
    return map;
  }, [projects]);

  const dependencyEdgeGeometry = useMemo(
    () => buildDependencyEdges(dependencyEdges, taskBoxes),
    [dependencyEdges, taskBoxes],
  );

  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const showDate = (date: Date) => setRequestedStart(date);

  const totalScheduledTasks = flatSchedule.length;
  const hasProjects = rows.length > 0;

  return (
    <>
      <PageTitle title={t("portfolio:title")} />
      <WorkspaceLayout title={t("portfolio:title")} className="flex-wrap">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>{t("portfolio:loadErrorTitle")}</EmptyTitle>
              <EmptyDescription>{t("portfolio:loadError")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !hasProjects ? (
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>{t("portfolio:noProjectsTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("portfolio:noProjectsSubtitle")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !range || !timeline || totalScheduledTasks === 0 ? (
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Calendar />
              </EmptyMedia>
              <EmptyTitle>{t("portfolio:noScheduledTasksTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("portfolio:noScheduledTasksSubtitle")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:px-6">
              <fieldset className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
                <legend className="sr-only">
                  {t("tasks:gantt.unitControlAriaLabel")}
                </legend>
                {GANTT_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={effectiveGanttUnit === unit}
                    onClick={() => handleUnitChange(unit)}
                    className={cn(
                      "min-h-9 touch-manipulation rounded-sm px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0",
                      effectiveGanttUnit === unit
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {t(GANTT_UNIT_LABEL_KEYS[unit])}
                  </button>
                ))}
              </fieldset>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t("tasks:gantt.previousPeriod")}
                  disabled={!range.hasPrevious}
                  onClick={() =>
                    showDate(addDays(range.rangeStart, -range.windowDays))
                  }
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {canMoveGanttWindowStart(range) ? (
                  <input
                    type="date"
                    aria-label={t("tasks:gantt.periodStart")}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    min={format(range.minimumStart, "yyyy-MM-dd")}
                    max={format(range.maximumStart, "yyyy-MM-dd")}
                    value={format(range.rangeStart, "yyyy-MM-dd")}
                    onChange={(event) => {
                      const date = parseTaskDate(event.target.value);
                      if (date) showDate(date);
                    }}
                  />
                ) : (
                  // Every task fits in one period, so min equals max and the
                  // field could not accept any change: show it disabled with
                  // a hint instead of an editable-looking control.
                  <span title={t("tasks:gantt.periodStartLocked")}>
                    <input
                      type="date"
                      disabled
                      aria-label={t("tasks:gantt.periodStart")}
                      aria-describedby={periodStartHintId}
                      className="h-9 rounded-md border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      value={format(range.rangeStart, "yyyy-MM-dd")}
                    />
                    <span id={periodStartHintId} className="sr-only">
                      {t("tasks:gantt.periodStartLocked")}
                    </span>
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  – {format(range.rangeEnd, "MMM d, yyyy")}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t("tasks:gantt.nextPeriod")}
                  disabled={!range.hasNext}
                  onClick={() =>
                    showDate(addDays(range.rangeStart, range.windowDays))
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              <Button
                variant="outline"
                size="xs"
                className="min-h-11 touch-manipulation sm:min-h-0"
                onClick={() => showDate(new Date())}
              >
                <Calendar className="size-3.5" />
                {t("tasks:gantt.jumpToToday")}
              </Button>
            </div>

            <div
              ref={viewportRef}
              data-testid="portfolio-scroll-container"
              className="min-h-0 flex-1 overflow-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
            >
              <div
                className={cn(
                  "relative min-w-max touch-pan-x touch-pan-y",
                  isPanning ? "cursor-grabbing" : "cursor-grab",
                )}
                onPointerDown={onTimelinePointerDown}
                onPointerMove={onTimelinePointerMove}
                onPointerUp={onTimelinePointerUp}
                onPointerCancel={onTimelinePointerCancel}
              >
                <div className="sticky top-0 z-20 flex border-b border-border bg-background/95 backdrop-blur">
                  <div
                    className="sticky left-0 z-30 shrink-0 select-none border-r border-border bg-background px-3 py-2.5"
                    style={{ width: `${railWidthRem}rem` }}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("portfolio:railHeader")}
                    </p>
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: timeline.gridTemplateColumns,
                    }}
                  >
                    {headerColumns.map((column) => {
                      // Any day the column spans can be today, not just its
                      // first — in Week/Month/Quarter a column covers many
                      // days, so checking only range.days[startIndex] would
                      // hide the marker whenever today falls mid-column.
                      const columnIsToday = range.days
                        .slice(column.startIndex, column.endIndex + 1)
                        .some((day) => isToday(day));
                      return (
                        <div
                          key={column.startIndex}
                          style={{
                            gridColumn: `${column.startIndex + 1} / ${column.endIndex + 2}`,
                          }}
                          className={cn(
                            "border-r border-border/60 px-1 py-2 text-center text-[11px] font-medium text-muted-foreground",
                            columnIsToday && "bg-primary/10 text-foreground",
                          )}
                        >
                          {column.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  ref={rowsContainerRef}
                  className="relative"
                  // Empty band after the last row so a backward connector's
                  // detour lane (routed under the bottom row, never above the
                  // sticky header) stays inside the scrollable area — see
                  // DEPENDENCY_LANE_CLEARANCE_PX.
                  style={{ paddingBottom: DEPENDENCY_LANE_CLEARANCE_PX }}
                >
                  <GanttDependencyOverlay
                    edges={dependencyEdgeGeometry}
                    hoveredTaskId={null}
                    clipLeftPx={railWidthRem * getRootFontSizePx()}
                    resolveProjectId={(taskId) => projectIdByTaskId.get(taskId)}
                  />
                  {rows.map((row) => {
                    const collapsed = collapsedProjectIds.has(row.id);
                    const Icon =
                      icons[row.icon as keyof typeof icons] ?? icons.Layout;
                    return (
                      <div key={row.id} className="border-b border-border/60">
                        <div className="flex items-stretch">
                          <div
                            className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-background bg-[linear-gradient(color-mix(in_srgb,var(--muted)_40%,transparent),color-mix(in_srgb,var(--muted)_40%,transparent))] px-2 py-2"
                            style={{ width: `${railWidthRem}rem` }}
                          >
                            <button
                              type="button"
                              aria-label={t(
                                "portfolio:toggleProjectAriaLabel",
                                {
                                  name: row.name,
                                },
                              )}
                              aria-expanded={!collapsed}
                              onClick={() => toggleProject(row.id)}
                              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <ChevronDown
                                className={cn(
                                  "size-3.5 transition-transform",
                                  collapsed && "-rotate-90",
                                )}
                              />
                            </button>
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                              {row.name}
                            </span>
                            <button
                              type="button"
                              aria-label={t(
                                "portfolio:openProjectGanttAriaLabel",
                                { name: row.name },
                              )}
                              title={t("portfolio:openProjectGanttAriaLabel", {
                                name: row.name,
                              })}
                              onClick={() =>
                                navigate({
                                  to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
                                  params: { workspaceId, projectId: row.id },
                                })
                              }
                              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <ArrowUpRight className="size-3.5" />
                            </button>
                          </div>
                          <div
                            className="relative grid min-h-[36px] items-center"
                            style={{
                              gridTemplateColumns: timeline.gridTemplateColumns,
                            }}
                          >
                            {row.summarySpan && (
                              <GanttSummaryTaskBar
                                title={row.name}
                                scheduleStart={row.summarySpan.start}
                                scheduleEnd={row.summarySpan.end}
                                timeline={timeline}
                                progress={row.summaryProgress}
                                onOpenTask={() =>
                                  navigate({
                                    to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
                                    params: { workspaceId, projectId: row.id },
                                  })
                                }
                              />
                            )}
                          </div>
                        </div>

                        {!collapsed &&
                          row.tasks.map((task) => (
                            <div key={task.id} className="flex items-stretch">
                              <div
                                className="sticky left-0 z-10 shrink-0 border-r border-border bg-background px-2 py-2 pl-9"
                                style={{ width: `${railWidthRem}rem` }}
                              >
                                <span className="block truncate text-xs text-foreground">
                                  {task.title}
                                </span>
                              </div>
                              <div
                                ref={(element) => {
                                  if (element) {
                                    taskRowElementsRef.current.set(
                                      task.id,
                                      element,
                                    );
                                  } else {
                                    taskRowElementsRef.current.delete(task.id);
                                  }
                                }}
                                className="relative grid min-h-[36px] items-center"
                                style={{
                                  gridTemplateColumns:
                                    timeline.gridTemplateColumns,
                                }}
                              >
                                <GanttPortfolioTaskBar
                                  task={task}
                                  timeline={timeline}
                                  onOpenTask={() =>
                                    setSelectedTask({
                                      taskId: task.id,
                                      projectId: row.id,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </WorkspaceLayout>

      {selectedTask && (
        <TaskDetailsSheet
          taskId={selectedTask.taskId}
          projectId={selectedTask.projectId}
          workspaceId={workspaceId}
          // The portfolio is a workspace view, not a project view.
          showNeighborhood={false}
          onClose={() => {
            setSelectedTask(null);
            // Task mutation hooks invalidate ["task"]/["tasks", projectId] but
            // not the cross-project ["portfolio"] query, so refresh it when the
            // sheet closes to reflect edits made from within this view.
            queryClient.invalidateQueries({
              queryKey: ["portfolio", workspaceId],
            });
          }}
        />
      )}
    </>
  );
}
