import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskProgressPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export default function TaskProgressPopover({
  task,
  children,
}: TaskProgressPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [localProgress, setLocalProgress] = useState(task.progress ?? 0);
  // The exact-number field's own text, kept separate from `localProgress` so
  // an in-progress edit (e.g. a momentarily empty field while retyping) isn't
  // clobbered every render — it's resynced from localProgress only when the
  // slider (or the popover reopening) is the thing that changed it.
  const [progressInput, setProgressInput] = useState(
    String(task.progress ?? 0),
  );
  // The last value this popover has actually sent to the server, deduped
  // against instead of the `task.progress` prop: after a commit resolves, the
  // prop only catches up once the refetch lands, so comparing against it lets
  // a second trigger for the same value (e.g. committing on Enter and then the
  // field blurring as the popover closes) fire a duplicate mutation and a
  // duplicate success toast in that window. This ref updates synchronously.
  const lastCommittedRef = useRef(task.progress ?? 0);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  useEffect(() => {
    setProgressInput(String(localProgress));
  }, [localProgress]);

  const handleCommit = async (value: number) => {
    const clamped = clampProgress(value);
    if (clamped === lastCommittedRef.current) return;
    const previousCommitted = lastCommittedRef.current;
    lastCommittedRef.current = clamped;
    try {
      await updateTask({ ...task, progress: clamped });
      toast.success(t("tasks:popover.progress.updateSuccess"));
    } catch (error) {
      lastCommittedRef.current = previousCommitted;
      setLocalProgress(task.progress ?? 0);
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.progress.updateError"),
      );
    }
  };

  const handleInputCommit = () => {
    const parsed = Number.parseInt(progressInput, 10);
    // An unparseable or empty field reverts to the last known-good value
    // instead of silently persisting 0 — the number input has no min/max
    // enforcement of its own the way the slider's step does.
    const nextValue = Number.isNaN(parsed) ? localProgress : parsed;
    const clamped = clampProgress(nextValue);
    // Resync the field text directly, not only via the localProgress effect:
    // when the clamped/reverted value equals the current localProgress (e.g.
    // typing "150" while already at 100, or unparseable text over an unchanged
    // value), setLocalProgress is a no-op, its effect never fires, and the
    // invalid text would otherwise stay displayed in the field.
    setProgressInput(String(clamped));
    setLocalProgress(clamped);
    handleCommit(clamped);
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLocalProgress(task.progress ?? 0);
          lastCommittedRef.current = task.progress ?? 0;
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("tasks:popover.progress.percentLabel")}
            </span>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                size="sm"
                className="w-16 text-right tabular-nums"
                value={progressInput}
                aria-label={t("tasks:popover.progress.exactLabel")}
                onChange={(e) => setProgressInput(e.target.value)}
                onBlur={handleInputCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleInputCommit();
                  }
                }}
              />
              <span className="text-sm font-semibold text-muted-foreground">
                %
              </span>
            </div>
          </div>
          <Slider
            value={localProgress}
            min={0}
            max={100}
            step={5}
            aria-label={t("tasks:popover.progress.percentLabel")}
            onValueChange={(value) =>
              setLocalProgress(Array.isArray(value) ? value[0] : value)
            }
            onValueCommitted={(value) =>
              handleCommit(Array.isArray(value) ? value[0] : value)
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
