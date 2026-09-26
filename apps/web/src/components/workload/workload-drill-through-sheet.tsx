import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ListTodo, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { WORKLOAD_UNASSIGNED_ASSIGNEE } from "@/fetchers/workload/get-workspace-workload-tasks";
import useWorkspaceWorkloadTasks from "@/hooks/queries/workload/use-workspace-workload-tasks";
import { getPriorityIcon } from "@/lib/priority";

export type WorkloadDrillThroughRequest = {
  /** The row's real user id, or `null` for the unassigned row. */
  userId: string | null;
  label: string;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
};

type WorkloadDrillThroughSheetProps = {
  workspaceId: string;
  request: WorkloadDrillThroughRequest | null;
  onClose: () => void;
};

export default function WorkloadDrillThroughSheet({
  workspaceId,
  request,
  onClose,
}: WorkloadDrillThroughSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const assigneeId = request
    ? (request.userId ?? WORKLOAD_UNASSIGNED_ASSIGNEE)
    : undefined;

  const { data, isLoading, isError } = useWorkspaceWorkloadTasks({
    workspaceId,
    from: request?.from ?? "",
    to: request?.to ?? "",
    assigneeId,
  });

  const tasks = data?.tasks ?? [];

  return (
    <Sheet open={!!request} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {request
              ? t("workspace:workload.drillThrough.title", {
                  name: request.label,
                })
              : ""}
          </SheetTitle>
          <SheetDescription>
            {request
              ? t("workspace:workload.drillThrough.subtitle", {
                  from: format(new Date(`${request.from}T00:00:00`), "MMM d"),
                  to: format(new Date(`${request.to}T00:00:00`), "MMM d, yyyy"),
                })
              : ""}
          </SheetDescription>
        </SheetHeader>
        <SheetPanel className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {t("workspace:workload.drillThrough.error")}
            </p>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ListTodo className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("workspace:workload.drillThrough.empty")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {data?.truncated ? (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {t("workspace:workload.truncatedNotice")}
                </div>
              ) : null}
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                      params: { workspaceId, projectId: task.projectId },
                      search: { taskId: task.id },
                    });
                    onClose();
                  }}
                  className="flex w-full items-start gap-2.5 rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-accent/60"
                >
                  <div className="mt-0.5 shrink-0">
                    {getPriorityIcon(task.priority)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {task.projectSlug}
                        {task.taskNumber !== null ? `-${task.taskNumber}` : ""}
                      </span>
                      <span className="truncate text-sm text-foreground">
                        {task.title}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {task.projectName}
                      {task.dueDate
                        ? t("workspace:workload.drillThrough.dueOn", {
                            date: format(new Date(task.dueDate), "MMM d"),
                          })
                        : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}
