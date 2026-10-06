import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useProjectPermission } from "@/hooks/use-project-permission";
import {
  type EstimateUnit,
  hasFullDateRange,
  isEstimateUnit,
} from "@/lib/estimate";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import EstimateEditor from "./estimate-editor";

type TaskEstimatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

function unitOf(task: Task): EstimateUnit {
  return isEstimateUnit(task.estimateUnit) ? task.estimateUnit : "hours";
}

// Edits the task's effort estimate: a decimal amount in hours or work days
// (8 h), stored as whole minutes. An empty field clears the estimate. On the
// Gantt the estimate gives a task with no dates, or with exactly one date, a
// display length (see gantt-derived-schedule.ts); it never changes stored
// dates. A task with both dates cannot take an estimate (the API refuses it),
// so the field is disabled with a hint until one date is cleared.
export default function TaskEstimatePopover({
  task,
  children,
}: TaskEstimatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canUpdateTasks } = useProjectPermission(task.projectId);
  const canEdit = canUpdateTasks();
  const blockedByDates = hasFullDateRange(task.startDate, task.dueDate);

  const save = async (
    estimateMinutes: number | null,
    estimateUnit: EstimateUnit,
  ) => {
    try {
      await updateTask({ ...task, estimateMinutes, estimateUnit });
      toast.success(t("tasks:popover.estimate.updateSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.estimate.updateError"),
      );
      // The editor reverts its field on a rejection.
      throw error;
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        {/* Mounted only while open so every opening starts from the task's
            current estimate. */}
        {open && (
          <EstimateEditor
            minutes={task.estimateMinutes ?? null}
            unit={unitOf(task)}
            onSave={save}
            disabled={blockedByDates}
            disabledHint={t("tasks:popover.estimate.blockedByDates")}
            hint={t("tasks:popover.estimate.exclusiveHint")}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
