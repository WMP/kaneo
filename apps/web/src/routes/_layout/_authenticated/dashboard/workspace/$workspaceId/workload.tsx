import { createFileRoute } from "@tanstack/react-router";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, TriangleAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import WorkloadDrillThroughSheet, {
  type WorkloadDrillThroughRequest,
} from "@/components/workload/workload-drill-through-sheet";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useWorkspaceWorkload from "@/hooks/queries/workload/use-workspace-workload";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/workload",
)({
  component: WorkloadComponent,
});

const DATE_FORMAT = "yyyy-MM-dd";
const THRESHOLD_OPTIONS = [2, 3, 4, 5, 8];
// The previous fixed window, kept as the "default range" quick action.
const DEFAULT_WINDOW_DAYS = 8 * 7;
// Must track the API's own `MAX_WEEK_BUCKETS` cap so a picked range is never
// rejected after the fact; clamped client-side via the date inputs' `max`.
const MAX_RANGE_DAYS = 53 * 7;

type ViewMode = "weekly" | "summary";

function dayKey(date: Date) {
  return format(date, DATE_FORMAT);
}

function parseDayKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

// Bucket boundaries are date-only values the API anchors at UTC midnight.
// Render them from their calendar date so week labels don't slip a day for
// viewers in negative-offset time zones (where `new Date(...Z)` lands on the
// previous day).
function bucketDay(value: string | Date) {
  const iso = typeof value === "string" ? value : value.toISOString();
  return new Date(`${iso.slice(0, 10)}T00:00:00`);
}

// One neutral, monotone ramp for magnitude (how loaded, relative to the
// threshold), separate from the reserved warning color used for overload.
function magnitudeClassName(count: number, threshold: number) {
  if (count <= 0) return "text-muted-foreground/70";
  const ratio = count / threshold;
  if (ratio <= 1 / 3) return "bg-foreground/5";
  if (ratio <= 2 / 3) return "bg-foreground/10";
  return "bg-foreground/15 font-medium";
}

function defaultRangeStart() {
  return startOfWeek(new Date(), { weekStartsOn: 1 });
}

function WorkloadComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  const [from, setFrom] = useState(() => dayKey(defaultRangeStart()));
  const [to, setTo] = useState(() =>
    dayKey(addDays(defaultRangeStart(), DEFAULT_WINDOW_DAYS - 1)),
  );
  const [overloadThreshold, setOverloadThreshold] = useState(3);
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const [projectId, setProjectId] = useState("");
  const [drillThrough, setDrillThrough] =
    useState<WorkloadDrillThroughRequest | null>(null);

  const { data: projects } = useGetProjects({ workspaceId });

  const { data, isLoading, isFetching, isError } = useWorkspaceWorkload({
    workspaceId,
    from,
    to,
    projectId: projectId || undefined,
  });

  // The span of the current selection, in days -- used both to page by "the
  // range the person is already looking at" and to clamp `to` so a picked
  // range never exceeds the API's bucket cap.
  const rangeDays = Math.max(
    1,
    differenceInCalendarDays(parseDayKey(to), parseDayKey(from)) + 1,
  );

  const rangeLabel = useMemo(
    () =>
      `${format(parseDayKey(from), "MMM d, yyyy")} – ${format(parseDayKey(to), "MMM d, yyyy")}`,
    [from, to],
  );

  const applyRange = (nextFrom: Date, nextTo: Date) => {
    const clampedTo =
      differenceInCalendarDays(nextTo, nextFrom) >= MAX_RANGE_DAYS
        ? addDays(nextFrom, MAX_RANGE_DAYS - 1)
        : nextTo;
    setFrom(dayKey(nextFrom));
    setTo(dayKey(clampedTo < nextFrom ? nextFrom : clampedTo));
  };

  const shiftRange = (direction: 1 | -1) => {
    applyRange(
      addDays(parseDayKey(from), direction * rangeDays),
      addDays(parseDayKey(to), direction * rangeDays),
    );
  };

  const resetToDefaultRange = () => {
    const start = defaultRangeStart();
    applyRange(start, addDays(start, DEFAULT_WINDOW_DAYS - 1));
  };

  const selectThisYear = () => {
    const year = new Date().getFullYear();
    applyRange(new Date(year, 0, 1), new Date(year, 11, 31));
  };

  const buckets = data?.buckets ?? [];
  const assignees = data?.assignees ?? [];
  const hasData = assignees.length > 0;
  const showLoading = isLoading || (isFetching && !data);

  // A coarse, whole-range figure per person: how much they're carrying and
  // how often they crossed the threshold, without a wide per-week grid --
  // meant for scanning a long range (a quarter, a year) at a glance.
  const summaryRows = useMemo(() => {
    const rows = assignees.map((assignee) => {
      const total = assignee.counts.reduce((sum, count) => sum + count, 0);
      const overloadedWeeks = assignee.counts.filter(
        (count) => count > overloadThreshold,
      ).length;
      return { ...assignee, total, overloadedWeeks };
    });
    return rows.sort((a, b) => {
      // The unassigned row always sorts last, same as the weekly table.
      if (a.userId === null) return b.userId === null ? 0 : 1;
      if (b.userId === null) return -1;
      return b.total - a.total;
    });
  }, [assignees, overloadThreshold]);

  const openDrillThrough = (
    assignee: { userId: string | null; name: string | null },
    bucket?: { start: string | Date; end: string | Date },
  ) => {
    const rangeFrom = bucket ? dayKey(bucketDay(bucket.start)) : from;
    const rangeTo = bucket ? dayKey(addDays(bucketDay(bucket.end), -1)) : to;
    setDrillThrough({
      userId: assignee.userId,
      label: assignee.userId
        ? (assignee.name ?? "")
        : t("workspace:workload.unassigned"),
      from: rangeFrom,
      to: rangeTo,
      projectId: projectId || undefined,
    });
  };

  const maxToValue = dayKey(addDays(parseDayKey(from), MAX_RANGE_DAYS - 1));

  return (
    <>
      <PageTitle title={t("workspace:workload.pageTitle")} />
      <WorkspaceLayout title={t("workspace:workload.pageTitle")}>
        <div className="flex flex-col gap-3 border-b border-border px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => shiftRange(-1)}
              aria-label={t("workspace:workload.previousWeeks")}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("workspace:workload.fromLabel")}
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={from}
                max={to}
                onChange={(event) => {
                  if (!event.target.value) return;
                  applyRange(parseDayKey(event.target.value), parseDayKey(to));
                }}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("workspace:workload.toLabel")}
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={to}
                min={from}
                max={maxToValue}
                onChange={(event) => {
                  if (!event.target.value) return;
                  applyRange(
                    parseDayKey(from),
                    parseDayKey(event.target.value),
                  );
                }}
              />
            </label>

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => shiftRange(1)}
              aria-label={t("workspace:workload.nextWeeks")}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            <Button variant="ghost" size="xs" onClick={resetToDefaultRange}>
              {t("workspace:workload.jumpToToday")}
            </Button>
            <Button variant="ghost" size="xs" onClick={selectThisYear}>
              {t("workspace:workload.quickThisYear")}
            </Button>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("workspace:activityLog.filters.project")}
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-8 min-w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring"
              >
                <option value="">
                  {t("workspace:activityLog.filters.allProjects")}
                </option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <span className="text-xs text-muted-foreground whitespace-nowrap px-1">
              {rangeLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
              <legend className="sr-only">
                {t("workspace:workload.viewModeAriaLabel")}
              </legend>
              {(["weekly", "summary"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {mode === "weekly"
                    ? t("workspace:workload.viewModeWeekly")
                    : t("workspace:workload.viewModeSummary")}
                </button>
              ))}
            </fieldset>

            <Select
              value={String(overloadThreshold)}
              onValueChange={(value) => {
                const parsed = Number(value);
                if (Number.isFinite(parsed) && parsed > 0) {
                  setOverloadThreshold(parsed);
                }
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-auto min-w-32">
                <SelectValue>
                  {t("workspace:workload.overloadThresholdValue", {
                    count: overloadThreshold,
                  })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {t("workspace:workload.overloadThresholdValue", {
                      count: option,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {t("workspace:workload.subtitle")}
          </p>

          {showLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                {t("workspace:workload.loading")}
              </p>
            </div>
          ) : isError ? (
            <div className="text-center py-16">
              <p className="text-sm text-destructive">
                {t("workspace:workload.error")}
              </p>
            </div>
          ) : !hasData ? (
            <div className="text-center py-16">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">
                {t("workspace:workload.emptyTitle")}
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                {t("workspace:workload.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data?.truncated ? (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  {t("workspace:workload.truncatedNotice")}
                </div>
              ) : null}

              {viewMode === "weekly" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background">
                        {t("workspace:workload.assigneeColumn")}
                      </TableHead>
                      {buckets.map((bucket) => (
                        <TableHead
                          key={bucket.start}
                          className="text-center"
                          title={`${format(bucketDay(bucket.start), "MMM d")} – ${format(
                            addDays(bucketDay(bucket.end), -1),
                            "MMM d",
                          )}`}
                        >
                          {format(bucketDay(bucket.start), "MMM d")}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignees.map((assignee) => (
                      <TableRow key={assignee.userId ?? "unassigned"}>
                        <TableCell className="sticky left-0 bg-background p-0">
                          <button
                            type="button"
                            onClick={() => openDrillThrough(assignee)}
                            aria-label={t(
                              "workspace:workload.openPersonTasksAriaLabel",
                              {
                                name:
                                  assignee.name ??
                                  t("workspace:workload.unassigned"),
                              },
                            )}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/60"
                          >
                            {assignee.userId ? (
                              <>
                                <Avatar className="size-6">
                                  <AvatarImage
                                    src={assignee.image ?? ""}
                                    alt={assignee.name ?? ""}
                                  />
                                  <AvatarFallback className="text-[10px]">
                                    {getInitials(assignee.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium">
                                  {assignee.name}
                                </span>
                              </>
                            ) : (
                              <>
                                <Avatar className="size-6">
                                  <AvatarFallback className="text-[10px] bg-muted">
                                    <Users className="w-3 h-3" />
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm text-muted-foreground italic">
                                  {t("workspace:workload.unassigned")}
                                </span>
                              </>
                            )}
                          </button>
                        </TableCell>
                        {assignee.counts.map((count, index) => {
                          const bucket = buckets[index];
                          const isOverloaded = count > overloadThreshold;
                          return (
                            <TableCell
                              // biome-ignore lint/suspicious/noArrayIndexKey: buckets are a fixed, index-aligned sequence for this row
                              key={index}
                              className="p-0 text-center tabular-nums"
                            >
                              <button
                                type="button"
                                disabled={!bucket}
                                onClick={() =>
                                  bucket && openDrillThrough(assignee, bucket)
                                }
                                className={cn(
                                  "w-full px-2 py-2 disabled:cursor-default",
                                  bucket && "hover:bg-accent/60",
                                  isOverloaded
                                    ? "bg-warning/15 text-warning-foreground font-semibold"
                                    : magnitudeClassName(
                                        count,
                                        overloadThreshold,
                                      ),
                                )}
                                title={
                                  bucket
                                    ? t("workspace:workload.cellTooltip", {
                                        count,
                                        date: format(
                                          bucketDay(bucket.start),
                                          "MMM d",
                                        ),
                                      })
                                    : undefined
                                }
                              >
                                <span className="inline-flex items-center gap-1">
                                  {isOverloaded ? (
                                    <TriangleAlert
                                      className="w-3 h-3"
                                      aria-hidden="true"
                                    />
                                  ) : null}
                                  {count}
                                  {isOverloaded ? (
                                    <span className="sr-only">
                                      {t(
                                        "workspace:workload.overloadedSrLabel",
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <TooltipProvider>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("workspace:workload.assigneeColumn")}
                        </TableHead>
                        <TableHead className="text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default underline decoration-dotted">
                                {t("workspace:workload.summaryTotalColumn")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("workspace:workload.summaryTotalTooltip")}
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default underline decoration-dotted">
                                {t("workspace:workload.summaryOverloadColumn")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("workspace:workload.summaryOverloadTooltip", {
                                count: overloadThreshold,
                              })}
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryRows.map((assignee) => (
                        <TableRow key={assignee.userId ?? "unassigned"}>
                          <TableCell className="p-0">
                            <button
                              type="button"
                              onClick={() => openDrillThrough(assignee)}
                              aria-label={t(
                                "workspace:workload.openPersonTasksAriaLabel",
                                {
                                  name:
                                    assignee.name ??
                                    t("workspace:workload.unassigned"),
                                },
                              )}
                              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/60"
                            >
                              {assignee.userId ? (
                                <>
                                  <Avatar className="size-6">
                                    <AvatarImage
                                      src={assignee.image ?? ""}
                                      alt={assignee.name ?? ""}
                                    />
                                    <AvatarFallback className="text-[10px]">
                                      {getInitials(assignee.name)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm font-medium">
                                    {assignee.name}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Avatar className="size-6">
                                    <AvatarFallback className="text-[10px] bg-muted">
                                      <Users className="w-3 h-3" />
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm text-muted-foreground italic">
                                    {t("workspace:workload.unassigned")}
                                  </span>
                                </>
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {assignee.total}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-center tabular-nums",
                              assignee.overloadedWeeks > 0 &&
                                "text-warning-foreground font-semibold",
                            )}
                          >
                            {assignee.overloadedWeeks}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              )}

              {viewMode === "weekly" ? (
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-3 rounded-sm bg-foreground/15" />
                    {t("workspace:workload.legendLoad")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 text-warning-foreground" />
                    {t("workspace:workload.legendOverload", {
                      count: overloadThreshold,
                    })}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </WorkspaceLayout>

      <WorkloadDrillThroughSheet
        workspaceId={workspaceId}
        request={drillThrough}
        onClose={() => setDrillThrough(null)}
      />
    </>
  );
}
