import { Diamond, Flag, History, Hourglass, Percent } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { propertyChipClass } from "@/components/custom-fields/property-chip-class";
import { cn } from "@/lib/cn";
import { formatEstimate } from "@/lib/estimate";
import { formatDateShort } from "@/lib/format";
import { getApprovalStatusIcon } from "@/lib/approval";
import { getApprovalStatusLabel } from "@/lib/i18n/domain";
import type Task from "@/types/task";
import TaskApprovalPopover from "../task-approval-popover";
import TaskBaselinePopover from "../task-baseline-popover";
import TaskConstraintPopover from "../task-constraint-popover";
import TaskEstimatePopover from "../task-estimate-popover";
import TaskMilestonePopover from "../task-milestone-popover";
import TaskProgressPopover from "../task-progress-popover";
import { PropertyRow } from "./property-row";
import { PropertyValue } from "./property-value";

// The scheduling properties the Gantt reads: progress, estimate, milestone,
// baseline and date constraint, plus the approval gate. Each has an editing
// popover that is read-only for somebody who may not update the task; this file
// only lays them out, once as labeled rows (the details rail) and once as chips
// (the compact layout under the title).

type ScheduleItem = {
  id: string;
  label: string;
  icon: ReactNode;
  /** The value text, or null when the property is not set. */
  value: string | null;
  /** What the compact chip shows while the property is not set. */
  emptyChip: string;
  /** What the rail row shows while the property is not set. */
  emptyRow: string;
  active: boolean;
  wrap: (children: ReactNode) => ReactNode;
};

function useScheduleItems(task: Task): ScheduleItem[] {
  const { t } = useTranslation();
  const hasConstraint = Boolean(
    task.constraintType && task.constraintType !== "none",
  );
  const hasBaseline = Boolean(task.baselineStartDate || task.baselineDueDate);
  const approvalStatus = task.approvalStatus ?? "none";

  const baselineValue = hasBaseline
    ? [task.baselineStartDate, task.baselineDueDate]
        .map((date) => (date ? formatDateShort(date) : "…"))
        .join(" – ")
    : null;

  return [
    {
      id: "progress",
      label: t("tasks:properties.progress"),
      icon: <Percent className="text-muted-foreground" />,
      value: `${task.progress ?? 0}%`,
      emptyChip: "",
      emptyRow: "",
      active: false,
      wrap: (children) => (
        <TaskProgressPopover task={task}>{children}</TaskProgressPopover>
      ),
    },
    {
      id: "estimate",
      label: t("tasks:properties.estimate"),
      icon: <Hourglass className="text-muted-foreground" />,
      value:
        task.estimateMinutes == null
          ? null
          : formatEstimate(task.estimateMinutes, task.estimateUnit, t),
      emptyChip: t("tasks:properties.estimate"),
      emptyRow: "—",
      active: false,
      wrap: (children) => (
        <TaskEstimatePopover task={task}>{children}</TaskEstimatePopover>
      ),
    },
    {
      id: "milestone",
      label: t("tasks:properties.milestone"),
      icon: (
        <Diamond
          className={cn(
            task.isMilestone
              ? "fill-primary/20 text-primary"
              : "text-muted-foreground",
          )}
        />
      ),
      value: task.isMilestone ? t("tasks:properties.milestone") : null,
      emptyChip: t("tasks:properties.milestone"),
      emptyRow: "—",
      active: Boolean(task.isMilestone),
      wrap: (children) => (
        <TaskMilestonePopover task={task}>{children}</TaskMilestonePopover>
      ),
    },
    {
      id: "baseline",
      label: t("tasks:properties.baseline"),
      icon: <History className="text-muted-foreground" />,
      value: baselineValue,
      emptyChip: t("tasks:popover.baseline.set"),
      emptyRow: t("tasks:popover.baseline.none"),
      active: false,
      wrap: (children) => (
        <TaskBaselinePopover task={task}>{children}</TaskBaselinePopover>
      ),
    },
    {
      id: "constraint",
      label: t("tasks:properties.constraint"),
      icon: (
        <Flag
          className={cn(
            hasConstraint
              ? "fill-primary/20 text-primary"
              : "text-muted-foreground",
          )}
        />
      ),
      value: hasConstraint
        ? t(`tasks:popover.constraint.type.${task.constraintType}`)
        : null,
      emptyChip: t("tasks:properties.constraint"),
      emptyRow: t("tasks:popover.constraint.type.none"),
      active: hasConstraint,
      wrap: (children) => (
        <TaskConstraintPopover task={task}>{children}</TaskConstraintPopover>
      ),
    },
    {
      id: "approval",
      label: t("tasks:properties.approval"),
      icon: getApprovalStatusIcon(approvalStatus, "size-3.5"),
      value: getApprovalStatusLabel(approvalStatus),
      emptyChip: "",
      emptyRow: "",
      active: false,
      wrap: (children) => (
        <TaskApprovalPopover task={task}>{children}</TaskApprovalPopover>
      ),
    },
  ];
}

type SchedulePropertyRowsProps = {
  task: Task;
  /** False while the user may not edit the task: the values stay readable. */
  canEdit: boolean;
};

export function SchedulePropertyRows({
  task,
  canEdit,
}: SchedulePropertyRowsProps) {
  const items = useScheduleItems(task);

  return (
    <>
      {items.map((item) => (
        <PropertyRow key={item.id} label={item.label}>
          {item.wrap(
            <PropertyValue
              aria-label={item.label}
              disabled={!canEdit}
              className={cn(item.active && "text-primary")}
            >
              {item.icon}
              <span
                className={cn(
                  "truncate",
                  item.value === null && "text-muted-foreground",
                )}
              >
                {item.value ?? item.emptyRow}
              </span>
            </PropertyValue>,
          )}
        </PropertyRow>
      ))}
    </>
  );
}

const chip = cn(
  propertyChipClass,
  "h-8 bg-accent/30 text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
);

export function SchedulePropertyChips({
  task,
  canEdit,
}: SchedulePropertyRowsProps) {
  const items = useScheduleItems(task);

  return (
    <>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.wrap(
            <button
              type="button"
              aria-label={item.label}
              disabled={!canEdit}
              className={cn(chip, item.active && "text-primary")}
            >
              {item.icon}
              <span
                className={cn(
                  "truncate",
                  item.value === null && "text-muted-foreground",
                )}
              >
                {item.value ?? item.emptyChip}
              </span>
            </button>,
          )}
        </Fragment>
      ))}
    </>
  );
}
