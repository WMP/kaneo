import { Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import useGetJiraTask from "@/hooks/queries/jira-integration/use-get-jira-task";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { cn } from "@/lib/cn";
import { SendToJiraDialog } from "./send-to-jira-dialog";

// "Send to Jira" (or "Update in Jira" once the task is linked) for a task of a
// workspace with an active Jira connection; nothing otherwise. Sending writes
// the task's link, so it needs task:update in the task's project. The button
// only explains that; the API decides.
export function SendToJiraButton({
  taskId,
  projectId,
  workspaceId,
}: {
  taskId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: connection } = useGetJiraConnection(workspaceId);
  const active = connection?.isActive === true;
  const { data: info } = useGetJiraTask(taskId, { enabled: active });
  const { canUpdateTasks, isCheckingPermissions } =
    useProjectPermission(projectId);

  if (!active) return null;

  const allowed = canUpdateTasks();
  const label = info?.link
    ? t("tasks:jira.button.update")
    : t("tasks:jira.button.send");

  // Not `disabled`: a disabled button takes no focus and no pointer events, so
  // its explanation could not be read. `aria-disabled` keeps both.
  const button = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "text-foreground",
        !allowed && "cursor-not-allowed opacity-64",
      )}
      aria-disabled={!allowed || undefined}
      aria-label={label}
      onClick={() => {
        if (allowed) setOpen(true);
      }}
    >
      <Send className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <>
      {allowed || isCheckingPermissions ? (
        button
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              {t("tasks:jira.button.noPermission")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {allowed && (
        <SendToJiraDialog
          open={open}
          onOpenChange={setOpen}
          taskId={taskId}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
}
