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

type ApprovalOption = (typeof approvalStatusOptions)[number];

function toApprovalOption(value: string | null | undefined): ApprovalOption {
  return approvalStatusOptions.includes(value as ApprovalOption)
    ? (value as ApprovalOption)
    : "none";
}

export default function TaskApprovalPopover({
  task,
  children,
}: TaskApprovalPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(task.approvalNote ?? "");
  // Track the selected status locally so "Save note" persists the status the
  // user just chose rather than a possibly-stale `task.approvalStatus` prop
  // (the query has not necessarily refetched between a status click and a note
  // save). The dedicated approval endpoint requires a status, so a note-only
  // save must resend one; resending the stale prop value would silently revert
  // a just-made status change.
  const [status, setStatus] = useState<ApprovalOption>(
    toApprovalOption(task.approvalStatus),
  );
  const { mutateAsync: updateApproval, isPending } = useUpdateTaskApproval();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const handleStatusChange = useCallback(
    async (approvalStatus: ApprovalOption) => {
      const previousStatus = status;
      setStatus(approvalStatus);
      try {
        await updateApproval({
          taskId: task.id,
          projectId: task.projectId,
          approvalStatus,
          approvalNote: note.trim() ? note : null,
        });
      } catch (error) {
        setStatus(previousStatus);
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.approval.updateError"),
        );
      }
    },
    [note, status, t, task.id, task.projectId, updateApproval],
  );

  const handleSaveNote = useCallback(async () => {
    try {
      await updateApproval({
        taskId: task.id,
        projectId: task.projectId,
        approvalStatus: status,
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
  }, [note, status, t, task.id, task.projectId, updateApproval]);

  // Read-only role: render the trigger child as a plain element so the user
  // still sees the current approval status but can't open the popover.
  if (!canEdit) return <>{children}</>;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setNote(task.approvalNote ?? "");
          setStatus(toApprovalOption(task.approvalStatus));
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div>
          {approvalStatusOptions.map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              disabled={isPending}
              className="w-full justify-start gap-2 h-8 px-2 rounded-none first:rounded-t-md"
              onClick={() => handleStatusChange(option)}
            >
              {getApprovalStatusIcon(option)}
              <span className="text-sm">{getApprovalStatusLabel(option)}</span>
              {status === option && <Check className="ml-auto h-4 w-4" />}
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
