import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, History, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Activity from "@/components/activity";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Timeline } from "@/components/ui/timeline";
import useGetWorkspaceActivity from "@/hooks/queries/workspace/use-get-workspace-activity";
import useGetWorkspaceUsers from "@/hooks/queries/workspace-users/use-get-workspace-users";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/activity",
)({
  component: RouteComponent,
});

const ACTIVITY_TYPES = [
  "comment",
  "created",
  "status_changed",
  "priority_changed",
  "assignee_changed",
  "unassigned",
  "due_date_changed",
  "title_changed",
] as const;

const PAGE_SIZE = 25;

function toStartOfDayIso(value: string) {
  return new Date(`${value}T00:00:00.000`).toISOString();
}

function toEndOfDayIso(value: string) {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: workspaceUsers } = useGetWorkspaceUsers({ workspaceId });

  const [userId, setUserId] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const hasFilters = Boolean(userId || type || from || to);

  const { data, isLoading, isFetching, isError } = useGetWorkspaceActivity({
    workspaceId,
    userId: userId || undefined,
    type: type || undefined,
    from: from ? toStartOfDayIso(from) : undefined,
    to: to ? toEndOfDayIso(to) : undefined,
    page,
    limit: PAGE_SIZE,
  });

  const activities = useMemo(() => data?.data ?? [], [data]);
  const pagination = data?.pagination;

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function resetFilters() {
    setUserId("");
    setType("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <>
      <PageTitle title={t("workspace:activityLog.pageTitle")} />
      <WorkspaceLayout title={t("workspace:activityLog.pageTitle")}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end gap-3">
            <label
              className="flex flex-col gap-1.5 text-sm"
              htmlFor="activity-filter-user"
            >
              <span className="font-medium text-foreground">
                {t("workspace:activityLog.filters.user")}
              </span>
              <select
                id="activity-filter-user"
                value={userId}
                onChange={(event) =>
                  updateFilter(setUserId, event.target.value)
                }
                className="h-8.5 min-w-40 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-7.5"
              >
                <option value="">
                  {t("workspace:activityLog.filters.allUsers")}
                </option>
                {(workspaceUsers ?? []).map((member) =>
                  member.user?.id ? (
                    <option key={member.user.id} value={member.user.id}>
                      {member.user.name}
                    </option>
                  ) : null,
                )}
              </select>
            </label>

            <label
              className="flex flex-col gap-1.5 text-sm"
              htmlFor="activity-filter-type"
            >
              <span className="font-medium text-foreground">
                {t("workspace:activityLog.filters.type")}
              </span>
              <select
                id="activity-filter-type"
                value={type}
                onChange={(event) => updateFilter(setType, event.target.value)}
                className="h-8.5 min-w-40 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-7.5"
              >
                <option value="">
                  {t("workspace:activityLog.filters.allTypes")}
                </option>
                {ACTIVITY_TYPES.map((activityType) => (
                  <option key={activityType} value={activityType}>
                    {t(`workspace:activityLog.types.${activityType}`)}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="flex flex-col gap-1.5 text-sm"
              htmlFor="activity-filter-from"
            >
              <span className="font-medium text-foreground">
                {t("workspace:activityLog.filters.from")}
              </span>
              <Input
                id="activity-filter-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => updateFilter(setFrom, event.target.value)}
                className="w-40"
              />
            </label>

            <label
              className="flex flex-col gap-1.5 text-sm"
              htmlFor="activity-filter-to"
            >
              <span className="font-medium text-foreground">
                {t("workspace:activityLog.filters.to")}
              </span>
              <Input
                id="activity-filter-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => updateFilter(setTo, event.target.value)}
                className="w-40"
              />
            </label>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                {t("common:actions.reset")}
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="py-16 text-center text-sm text-destructive">
              {t("workspace:activityLog.error")}
            </p>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <History className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                {hasFilters
                  ? t("workspace:activityLog.emptyFilteredTitle")
                  : t("workspace:activityLog.emptyTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasFilters
                  ? t("workspace:activityLog.emptyFilteredDescription")
                  : t("workspace:activityLog.emptyDescription")}
              </p>
            </div>
          ) : (
            <Timeline>
              {activities.map((activity, index) => (
                <div key={activity.id} className="mb-1">
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/board"
                    params={{ workspaceId, projectId: activity.projectId }}
                    search={{ taskId: activity.taskId }}
                    className="ms-8 mb-1 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="shrink-0 font-mono">
                      {activity.projectSlug}-{activity.taskNumber}
                    </span>
                    <span className="truncate">{activity.taskTitle}</span>
                    <span className="shrink-0 text-muted-foreground/70">
                      · {activity.projectName}
                    </span>
                  </Link>
                  <Activity
                    activity={activity}
                    step={activities.length - index}
                  />
                </div>
              ))}
            </Timeline>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("workspace:activityLog.pagination", {
                  current: pagination.page,
                  total: pagination.totalPages,
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1 || isFetching}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("common:pagination.previous")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    pagination.page >= pagination.totalPages || isFetching
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  {t("common:pagination.next")}
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </>
  );
}
