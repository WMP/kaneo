import { createFileRoute } from "@tanstack/react-router";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
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
import useWorkspaceWorkload from "@/hooks/queries/workload/use-workspace-workload";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/workload",
)({
  component: WorkloadComponent,
});

// A fixed window keeps the request bounded and the table a stable width;
// people page through it with the prev/next controls instead.
const VISIBLE_WEEKS = 8;
const DATE_FORMAT = "yyyy-MM-dd";
const THRESHOLD_OPTIONS = [2, 3, 4, 5, 8];

function dayKey(date: Date) {
  return format(date, DATE_FORMAT);
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

function WorkloadComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const [windowStart, setWindowStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [overloadThreshold, setOverloadThreshold] = useState(3);

  const from = dayKey(windowStart);
  const to = dayKey(addDays(windowStart, VISIBLE_WEEKS * 7 - 1));

  const { data, isLoading, isFetching, isError } = useWorkspaceWorkload({
    workspaceId,
    from,
    to,
  });

  const rangeLabel = useMemo(
    () =>
      `${format(windowStart, "MMM d")} – ${format(
        addDays(windowStart, VISIBLE_WEEKS * 7 - 1),
        "MMM d, yyyy",
      )}`,
    [windowStart],
  );

  const assignees = data?.assignees ?? [];
  const buckets = data?.buckets ?? [];
  const hasData = assignees.length > 0;
  const showLoading = isLoading || (isFetching && !data);

  return (
    <>
      <PageTitle title={t("workspace:workload.pageTitle")} />
      <WorkspaceLayout
        title={t("workspace:workload.pageTitle")}
        headerActions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                setWindowStart((current) => addWeeks(current, -VISIBLE_WEEKS))
              }
              aria-label={t("workspace:workload.previousWeeks")}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground whitespace-nowrap px-1">
              {rangeLabel}
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                setWindowStart((current) => addWeeks(current, VISIBLE_WEEKS))
              }
              aria-label={t("workspace:workload.nextWeeks")}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setWindowStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
              }
            >
              {t("workspace:workload.jumpToToday")}
            </Button>
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
        }
      >
        <div className="space-y-4">
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
                      <TableCell className="sticky left-0 bg-background">
                        <div className="flex items-center gap-2">
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
                        </div>
                      </TableCell>
                      {assignee.counts.map((count, index) => {
                        const bucket = buckets[index];
                        const isOverloaded = count > overloadThreshold;
                        return (
                          <TableCell
                            // biome-ignore lint/suspicious/noArrayIndexKey: buckets are a fixed, index-aligned sequence for this row
                            key={index}
                            className={cn(
                              "text-center tabular-nums",
                              isOverloaded
                                ? "bg-warning/15 text-warning-foreground font-semibold"
                                : magnitudeClassName(count, overloadThreshold),
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
                                  {t("workspace:workload.overloadedSrLabel")}
                                </span>
                              ) : null}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

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
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </>
  );
}
