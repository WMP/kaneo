import { useTranslation } from "react-i18next";
import { formatEstimate } from "@/lib/estimate";
import { formatDateMedium } from "@/lib/format";
import { getStatusLabel } from "@/lib/i18n/domain";
import type { ExternalGanttTask } from "./gantt-external-task-bar";

type GanttExternalRailEntryProps = {
  task: ExternalGanttTask;
  /** Opens the task (an own row in this project's sheet, a cross-project row
   * in its own project, like the relations panel). Omitted: no button. */
  onOpenTask?: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

// The task-rail cell of a read-only Gantt row that is not an editable own bar:
// a related task from another project, or a task of this project that has no
// dates of its own and is drawn from its dependency (and estimate).
export function GanttExternalRailEntry({
  task,
  onOpenTask,
  onPointerDown,
}: GanttExternalRailEntryProps) {
  const { t } = useTranslation();
  const hasEstimate =
    task.estimateMinutes !== null && task.estimateMinutes !== undefined;

  // A derived row has no real dates of its own; show that its position comes
  // from the dependency (and the estimate that sizes it) rather than a
  // concrete (fabricated) date range.
  const note = task.isDerived
    ? hasEstimate
      ? t("tasks:gantt.derivedEstimateRailNote", {
          estimate: formatEstimate(
            task.estimateMinutes as number,
            task.estimateUnit,
            t,
          ),
        })
      : t("tasks:gantt.externalTaskDerivedRailNote")
    : `${formatDateMedium(task.scheduleStart)} - ${formatDateMedium(task.scheduleEnd)}`;

  const content = (
    <>
      <div className="flex w-full items-center gap-1.5">
        {/* The same status pill an own dated row shows. A task of another
            project carries only its status slug (its board is not loaded
            here), formatted exactly like the relations panel's slug fallback. */}
        {task.status ? (
          <span className="max-w-[7rem] truncate rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-secondary-foreground sm:max-w-none">
            {getStatusLabel(task.status)}
          </span>
        ) : null}
        <span className="max-w-[7rem] truncate rounded-full bg-secondary/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-secondary-foreground sm:max-w-none">
          {task.projectSlug}
          {task.number ? `-${task.number}` : ""}
        </span>
        {task.isOwnProject ? null : (
          <span className="truncate text-[10px] text-muted-foreground">
            {t("tasks:gantt.externalProjectBadge", {
              projectName: task.projectName,
            })}
          </span>
        )}
      </div>
      <p className="w-full line-clamp-1 text-xs font-medium leading-tight text-muted-foreground">
        {task.title}
      </p>
      <p className="w-full truncate text-[11px] leading-tight text-muted-foreground">
        {note}
      </p>
    </>
  );

  const className =
    "flex min-h-[44px] w-full min-w-0 flex-col items-start justify-center gap-0.5 px-2 py-2 text-left opacity-80 sm:min-h-0 sm:px-3 sm:py-1.5";

  if (onOpenTask) {
    return (
      <button
        type="button"
        className={`${className} transition-colors hover:bg-muted`}
        onPointerDown={onPointerDown}
        onClick={onOpenTask}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
