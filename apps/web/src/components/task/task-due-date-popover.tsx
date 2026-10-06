import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { isDateBlockedByEstimate } from "@/lib/estimate";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskDueDatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskDueDatePopover({
  task,
  children,
}: TaskDueDatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTaskDueDate } = useUpdateTaskDueDate();
  const { canUpdateTasks } = useProjectPermission(task.projectId);
  const canEdit = canUpdateTasks();
  // With an estimate a task holds a start or a due date, not both: the empty
  // picker is disabled while the other date is set.
  const blockedByEstimate = isDateBlockedByEstimate(
    task.estimateMinutes,
    task.dueDate,
    task.startDate,
  );

  const handleDateChange = async (date: Date | undefined) => {
    try {
      await updateTaskDueDate({
        ...task,
        dueDate: date?.toISOString() || null,
      });
      toast.success(t("tasks:popover.dueDate.updateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.dueDate.updateError"),
      );
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        {blockedByEstimate && (
          <p className="m-0 max-w-64 px-3 pt-3 text-xs text-muted-foreground">
            {t("tasks:popover.estimate.exclusiveHint")}
          </p>
        )}
        <Calendar
          mode="single"
          selected={task.dueDate ? new Date(task.dueDate) : undefined}
          onSelect={handleDateChange}
          disabled={
            blockedByEstimate
              ? true
              : task.startDate
                ? { before: new Date(task.startDate) }
                : undefined
          }
          className="w-full bg-popover"
        />
        {task.dueDate && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => handleDateChange(undefined)}
            >
              <X className="h-4 w-4" />
              {t("tasks:popover.dueDate.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
