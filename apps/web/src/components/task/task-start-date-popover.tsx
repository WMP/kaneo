import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DatePickerMenu } from "@/components/common/date-picker/date-picker-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { isDateBlockedByEstimate } from "@/lib/estimate";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskStartDatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskStartDatePopover({
  task,
  children,
}: TaskStartDatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canUpdateTasks } = useProjectPermission(task.projectId);
  const canEdit = canUpdateTasks();
  // With an estimate a task holds a start or a due date, not both: the empty
  // picker is disabled while the other date is set.
  const blockedByEstimate = isDateBlockedByEstimate(
    task.estimateMinutes,
    task.startDate,
    task.dueDate,
  );

  const handleDateChange = async (date: Date | null) => {
    try {
      await updateTask({
        ...task,
        startDate: date?.toISOString() ?? null,
      });
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.startDate.updateError"),
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
            label={t("tasks:properties.startDate")}
            placeholder={t("tasks:datePicker.startDatePlaceholder")}
            clearLabel={t("tasks:popover.startDate.clear")}
            value={task.startDate ? new Date(task.startDate) : null}
            onChange={handleDateChange}
            bounds={
              task.dueDate ? { after: new Date(task.dueDate) } : undefined
            }
            formatLimit={(date) => t("tasks:due.fullDate", { date })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
