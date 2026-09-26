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
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import {
  buildPortfolioRows,
  flattenPortfolioSchedule,
} from "@/components/gantt/gantt-portfolio";
import { GanttPortfolioTaskBar } from "@/components/gantt/gantt-portfolio-task-bar";
import { GanttSummaryTaskBar } from "@/components/gantt/gantt-summary-task-bar";
import {
  buildGanttGridMetrics,
  buildGanttHeaderColumns,
  buildGanttRange,
  GANTT_UNITS,
  type GanttUnit,
  parseTaskDate,
  pickDefaultGanttUnit,
} from "@/components/gantt/timeline";
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
// per-day grid math. This first version has no wheel-zoom of its own; the
// unit switch is the only zoom lever.
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
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetPortfolio({ workspaceId });

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

  const rows = useMemo(() => buildPortfolioRows(data ?? []), [data]);
  const flatSchedule = useMemo(() => flattenPortfolioSchedule(rows), [rows]);

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

  const effectiveGanttUnit = hasTouchedGanttUnit
    ? ganttUnit
    : pickDefaultGanttUnit(overallSpanDays);

  const handleUnitChange = (unit: GanttUnit) => {
    setGanttUnit(unit);
    setRequestedStart(null);
  };

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

  const dayColumnWidthRem = isMobile
    ? UNIT_DAY_COLUMN_WIDTH_REM[effectiveGanttUnit].mobile
    : UNIT_DAY_COLUMN_WIDTH_REM[effectiveGanttUnit].desktop;
  const railWidthRem = isMobile
    ? RAIL_WIDTH_REM.mobile
    : RAIL_WIDTH_REM.desktop;

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
          <div className="flex min-h-0 flex-1 flex-col">
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

            <div className="min-h-0 flex-1 overflow-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
              <div className="relative min-w-max">
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

                {rows.map((row) => {
                  const collapsed = collapsedProjectIds.has(row.id);
                  const Icon =
                    icons[row.icon as keyof typeof icons] ?? icons.Layout;
                  return (
                    <div key={row.id} className="border-b border-border/60">
                      <div className="flex items-stretch">
                        <div
                          className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-muted/40 px-2 py-2"
                          style={{ width: `${railWidthRem}rem` }}
                        >
                          <button
                            type="button"
                            aria-label={t("portfolio:toggleProjectAriaLabel", {
                              name: row.name,
                            })}
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
        )}
      </WorkspaceLayout>

      {selectedTask && (
        <TaskDetailsSheet
          taskId={selectedTask.taskId}
          projectId={selectedTask.projectId}
          workspaceId={workspaceId}
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
