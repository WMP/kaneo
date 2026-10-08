import { useNavigate } from "@tanstack/react-router";
import { Maximize2, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SendToJiraButton } from "@/components/jira/send-to-jira-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import TaskDeleteButton from "./task-delete-button";
import TaskDetailsContent from "./task-details-content";
import TaskPropertiesSidebar from "./task-properties-sidebar";

type TaskDetailsSheetProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
  /** Extra content drawn over the blurred backdrop to the left of the sheet
   * (a view-specific aside, for example the Gantt's dependency neighborhood).
   * It is rendered inside the sheet's popup, so it is part of the modal focus
   * trap and a click inside it is not an outside press; the aside positions
   * itself against the popup (see GanttTaskNeighborhood). Omitted by every
   * other view. */
  backdropAside?: ReactNode;
};

export default function TaskDetailsSheet({
  taskId,
  projectId,
  workspaceId,
  onClose,
  backdropAside,
}: TaskDetailsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>(
    taskId,
  );

  const { data: task } = useGetTask(currentTaskId ?? "");
  const { data: project } = useGetProject({ id: projectId, workspaceId });

  useEffect(() => {
    if (taskId) {
      // Update taskId immediately without closing/reopening
      setCurrentTaskId(taskId);
    } else {
      // Delay clearing to allow exit animation
      const timer = setTimeout(() => {
        setCurrentTaskId(undefined);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [taskId]);

  const handleOpenFullPage = useCallback(() => {
    if (!currentTaskId) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId,
        projectId,
        taskId: currentTaskId,
      },
    });
  }, [navigate, workspaceId, projectId, currentTaskId]);

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-full sm:max-w-lg md:max-w-2xl lg:max-w-4xl p-0 gap-0 [&>button]:hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {project?.slug}-{task?.number}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {currentTaskId && (
              <SendToJiraButton
                taskId={currentTaskId}
                projectId={projectId}
                workspaceId={workspaceId}
              />
            )}
            {currentTaskId && (
              <TaskDeleteButton
                taskId={currentTaskId}
                projectId={projectId}
                onDeleted={onClose}
              />
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenFullPage}
                    className="text-foreground"
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("tasks:detail.openInFullPage")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          key={currentTaskId}
        >
          <TaskPropertiesSidebar
            taskId={currentTaskId}
            projectId={projectId}
            workspaceId={workspaceId}
            className="w-full bg-sidebar border-b border-border flex flex-col gap-0 overflow-y-auto shrink-0"
            compact={true}
          />

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-4 py-4">
              <TaskDetailsContent
                taskId={currentTaskId}
                projectId={projectId}
                workspaceId={workspaceId}
                className="flex flex-col gap-3"
              />
            </div>
          </div>
        </div>
        {backdropAside}
      </SheetContent>
    </Sheet>
  );
}
