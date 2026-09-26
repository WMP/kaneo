import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateTaskApproval } from "@/hooks/mutations/task/use-update-task-approval";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getApprovalStatusIcon } from "@/lib/approval";
import { getApprovalStatusLabel } from "@/lib/i18n/domain";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskApprovalPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

const approvalStatusOptions = [
  "none",
  "pending",
  "approved",
  "rejected",
] as const;

export default function TaskApprovalPopover({
  task,
  children,
}: TaskApprovalPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(task.approvalNote ?? "");
  const { mutateAsync: updateApproval, isPending } = useUpdateTaskApproval();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const handleStatusChange = useCallback(
    async (approvalStatus: (typeof approvalStatusOptions)[number]) => {
      try {
        await updateApproval({
          taskId: task.id,
          projectId: task.projectId,
          approvalStatus,
          approvalNote: note.trim() ? note : null,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.approval.updateError"),
        );
      }
    },
    [note, t, task.id, task.projectId, updateApproval],
  );

  const handleSaveNote = useCallback(async () => {
    try {
      await updateApproval({
        taskId: task.id,
        projectId: task.projectId,
        approvalStatus:
          (task.approvalStatus as (typeof approvalStatusOptions)[number]) ??
          "none",
        approvalNote: note.trim() ? note : null,
      });
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.approval.updateError"),
      );
    }
  }, [note, t, task.approvalStatus, task.id, task.projectId, updateApproval]);

  // Read-only role: render the trigger child as a plain element so the user
  // still sees the current approval status but can't open the popover.
  if (!canEdit) return <>{children}</>;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setNote(task.approvalNote ?? "");
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div>
          {approvalStatusOptions.map((status) => (
            <Button
              key={status}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2 rounded-none first:rounded-t-md"
              onClick={() => handleStatusChange(status)}
            >
              {getApprovalStatusIcon(status)}
              <span className="text-sm">{getApprovalStatusLabel(status)}</span>
              {(task.approvalStatus ?? "none") === status && (
                <Check className="ml-auto h-4 w-4" />
              )}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border p-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("tasks:popover.approval.note")}
          </span>
          <Textarea
            size="sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("tasks:popover.approval.notePlaceholder")}
            className="min-h-16"
          />
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            disabled={isPending}
            onClick={handleSaveNote}
          >
            {t("tasks:popover.approval.saveNote")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
