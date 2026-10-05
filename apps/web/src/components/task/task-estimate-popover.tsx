import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { cn } from "@/lib/cn";
import {
  ESTIMATE_UNITS,
  type EstimateUnit,
  isEstimateUnit,
  minutesToUnitValue,
  parseEstimateInput,
} from "@/lib/estimate";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskEstimatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

function unitOf(task: Task): EstimateUnit {
  return isEstimateUnit(task.estimateUnit) ? task.estimateUnit : "hours";
}

function fieldText(task: Task, unit: EstimateUnit): string {
  return task.estimateMinutes === null || task.estimateMinutes === undefined
    ? ""
    : String(minutesToUnitValue(task.estimateMinutes, unit));
}

// Edits the task's effort estimate: a decimal amount in hours or work days
// (8 h), stored as whole minutes. An empty field clears the estimate. On the
// Gantt the estimate only gives a task with no dates of its own a display
// length (see gantt-derived-schedule.ts); it never changes stored dates.
export default function TaskEstimatePopover({
  task,
  children,
}: TaskEstimatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<EstimateUnit>(unitOf(task));
  const [input, setInput] = useState(fieldText(task, unitOf(task)));
  // The last minutes value this popover sent (null = cleared), deduped against
  // instead of the `task` prop for the same reason as the progress popover: the
  // prop only catches up after the refetch, so Enter followed by the blur that
  // closing causes would otherwise save twice.
  const lastCommittedRef = useRef<number | null>(task.estimateMinutes ?? null);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canUpdateTasks } = useProjectPermission(task.projectId);
  const canEdit = canUpdateTasks();

  const resync = (nextUnit: EstimateUnit) => {
    setUnit(nextUnit);
    setInput(fieldText(task, nextUnit));
    lastCommittedRef.current = task.estimateMinutes ?? null;
  };

  const save = async (
    estimateMinutes: number | null,
    estimateUnit: EstimateUnit,
  ) => {
    const previous = lastCommittedRef.current;
    lastCommittedRef.current = estimateMinutes;
    try {
      await updateTask({ ...task, estimateMinutes, estimateUnit });
      toast.success(t("tasks:popover.estimate.updateSuccess"));
    } catch (error) {
      lastCommittedRef.current = previous;
      setInput(
        previous === null
          ? ""
          : String(minutesToUnitValue(previous, estimateUnit)),
      );
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.estimate.updateError"),
      );
    }
  };

  const handleCommit = () => {
    const parsed = parseEstimateInput(input, unit);
    if (parsed.kind === "invalid") {
      // Revert to the last saved value instead of persisting a guess.
      setInput(
        lastCommittedRef.current === null
          ? ""
          : String(minutesToUnitValue(lastCommittedRef.current, unit)),
      );
      return;
    }
    const next = parsed.kind === "empty" ? null : parsed.minutes;
    if (parsed.kind === "value") {
      setInput(String(minutesToUnitValue(parsed.minutes, unit)));
    }
    if (next === lastCommittedRef.current) return;
    void save(next, unit);
  };

  const handleUnitChange = (nextUnit: EstimateUnit) => {
    if (nextUnit === unit) return;
    // The stored quantity is minutes, so switching the unit re-expresses the
    // same estimate (8 h becomes 1 d) rather than reinterpreting the number.
    const parsed = parseEstimateInput(input, unit);
    const minutes =
      parsed.kind === "value" ? parsed.minutes : lastCommittedRef.current;
    setUnit(nextUnit);
    setInput(
      minutes === null ? "" : String(minutesToUnitValue(minutes, nextUnit)),
    );
    if (minutes !== null && minutes === lastCommittedRef.current) {
      void save(minutes, nextUnit);
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resync(unitOf(task));
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {t("tasks:popover.estimate.label")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("tasks:popover.estimate.description")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              size="sm"
              className="w-20 text-right tabular-nums"
              value={input}
              placeholder="0"
              aria-label={t("tasks:popover.estimate.amountLabel")}
              onChange={(e) => setInput(e.target.value)}
              onBlur={handleCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
            <fieldset
              aria-label={t("tasks:popover.estimate.unitLabel")}
              className="m-0 flex min-w-0 rounded-md border border-input p-0.5"
            >
              {ESTIMATE_UNITS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={unit === option}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    unit === option
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => handleUnitChange(option)}
                >
                  {t(`tasks:popover.estimate.units.${option}`)}
                </button>
              ))}
            </fieldset>
          </div>
          {task.estimateMinutes !== null &&
            task.estimateMinutes !== undefined && (
              <Button
                variant="ghost"
                size="xs"
                className="self-start text-muted-foreground"
                onClick={() => {
                  setInput("");
                  void save(null, unit);
                }}
              >
                {t("tasks:popover.estimate.clear")}
              </Button>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
