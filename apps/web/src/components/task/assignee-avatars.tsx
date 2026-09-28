import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import { getResourceKindIcon } from "@/lib/resource-kind-icon";
import type { AssigneeKind } from "@/types/resource";

export type { AssigneeKind };

export type AssigneeAvatarItem = {
  // Exactly one of userId/resourceId is set: a real Kaneo account, or an
  // account-less resource (person/equipment/material) from /resource.
  userId: string | null;
  resourceId?: string | null;
  // Missing/undefined is treated as "user", so every call site built before
  // resources existed (which only ever assigned users) keeps working.
  kind?: AssigneeKind;
  name: string;
  image: string | null;
};

type AssigneeSourceTask = {
  assignees?: AssigneeAvatarItem[];
  userId?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
};

/** A stable React key / identity for an assignee: its resource id, falling
 * back to its user id, falling back to its position (only reached if a
 * fixture supplies neither, which real data never does). */
export function getAssigneeKey(
  assignee: AssigneeAvatarItem,
  index: number,
): string {
  return assignee.resourceId ?? assignee.userId ?? `assignee-${index}`;
}

/**
 * The task's assignees for display, falling back to its single primary
 * assignee (assigneeId/assigneeName/assigneeImage) for a task or fixture
 * built before the assignees array existed, or a narrower task summary
 * that omits it.
 */
export function resolveTaskAssignees(
  task: AssigneeSourceTask,
): AssigneeAvatarItem[] {
  if (task.assignees && task.assignees.length > 0) {
    return task.assignees;
  }

  const primaryId = task.assigneeId ?? task.userId ?? null;
  if (!primaryId) return [];

  return [
    {
      userId: primaryId,
      name: task.assigneeName ?? "",
      image: task.assigneeImage ?? null,
    },
  ];
}

const DEFAULT_MAX_VISIBLE = 3;

type AssigneeAvatarsProps = {
  assignees: AssigneeAvatarItem[];
  /** How many avatars to show before collapsing the rest into a "+K" bubble. */
  max?: number;
  /** Tailwind size classes applied to each avatar and the overflow bubble. */
  avatarClassName?: string;
  className?: string;
};

/** Overlapping avatars for a task's assignees, with a "+K" overflow bubble
 * past `max` and an accessible group label listing everyone assigned.
 * Renders nothing for an empty list — callers that need an "unassigned"
 * placeholder render it themselves alongside this component. */
export function AssigneeAvatars({
  assignees,
  max = DEFAULT_MAX_VISIBLE,
  avatarClassName = "size-5",
  className,
}: AssigneeAvatarsProps) {
  const { t } = useTranslation();

  if (assignees.length === 0) return null;

  const visible = assignees.slice(0, max);
  const overflowCount = assignees.length - visible.length;
  const names = assignees
    .map((assignee) => assignee.name || assignee.userId || assignee.resourceId)
    .join(", ");

  return (
    <span
      role="img"
      aria-label={t("tasks:assignee.assignedAriaLabel", { names })}
      title={names}
      className={cn("inline-flex items-center -space-x-1.5", className)}
    >
      {visible.map((assignee, index) => {
        const KindIcon = getResourceKindIcon(assignee.kind);

        return (
          <Avatar
            key={getAssigneeKey(assignee, index)}
            className={cn(
              avatarClassName,
              "shrink-0 border border-background ring-1 ring-border/40",
            )}
          >
            {!KindIcon && (
              <AvatarImage src={assignee.image ?? ""} alt={assignee.name} />
            )}
            <AvatarFallback className="text-[9px] font-medium">
              {KindIcon ? (
                <KindIcon className="size-3" aria-hidden="true" />
              ) : (
                getInitials(assignee.name)
              )}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {overflowCount > 0 && (
        <span
          className={cn(
            avatarClassName,
            "flex shrink-0 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground ring-1 ring-border/40",
          )}
        >
          +{overflowCount}
        </span>
      )}
    </span>
  );
}

export default AssigneeAvatars;
