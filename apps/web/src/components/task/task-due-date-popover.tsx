import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DatePickerMenu } from "@/components/common/date-picker/date-picker-menu";
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

  const handleDateChange = async (date: Date | null) => {
    try {
      await updateTaskDueDate({
        ...task,
        dueDate: date?.toISOString() ?? null,
      });
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
      <PopoverContent className="w-65 p-0" align="start">
        {blockedByEstimate ? (
          <p className="m-0 px-3 py-3 text-xs text-muted-foreground">
            {t("tasks:popover.estimate.exclusiveHint")}
          </p>
        ) : (
          <DatePickerMenu
            label={t("tasks:dueDate.label")}
            placeholder={t("tasks:datePicker.dueDatePlaceholder")}
            clearLabel={t("tasks:popover.dueDate.clear")}
            value={task.dueDate ? new Date(task.dueDate) : null}
            onChange={handleDateChange}
            bounds={
              task.startDate ? { before: new Date(task.startDate) } : undefined
            }
            formatLimit={(date) => t("tasks:datePicker.startsOn", { date })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
