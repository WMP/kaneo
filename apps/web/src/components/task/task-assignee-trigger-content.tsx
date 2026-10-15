import { useTranslation } from "react-i18next";
import { UnassignedAvatar } from "@/components/common/unassigned-avatar";
import type { AssigneeProfile } from "@/lib/find-assignee";
import type Task from "@/types/task";
import { AssigneeAvatars, resolveTaskAssignees } from "./assignee-avatars";

// The trigger is a small button: only two avatars, at a size where a full
// two-letter initials label stays readable, then a "+K" bubble for the rest.
const TRIGGER_MAX_AVATARS = 2;

type TaskAssigneeTriggerContentProps = {
  task: Task;
  /** The project member behind `task.userId`, when still listed: their current
   * name and image win over the ones the task carries. */
  assignee?: AssigneeProfile;
};

/** What the assignee value of the task properties rail (and the compact
 * property chips) shows: the avatars of
 * everyone assigned (users and resources alike) with the name of a single
 * assignee or a count, or the "?" placeholder when nobody is. */
export function TaskAssigneeTriggerContent({
  task,
  assignee,
}: TaskAssigneeTriggerContentProps) {
  const { t } = useTranslation();

  const assignees = resolveTaskAssignees(task).map((entry) =>
    entry.userId && entry.userId === assignee?.userId
      ? {
          ...entry,
          name: assignee.user.name || entry.name,
          image: assignee.user.image ?? entry.image,
        }
      : entry,
  );

  if (assignees.length === 0) {
    return (
      <>
        <UnassignedAvatar className="size-4.5" />
        <span className="max-w-32 truncate text-muted-foreground">
          {t("tasks:popover.assignee.unassigned")}
        </span>
      </>
    );
  }

  return (
    <>
      <AssigneeAvatars
        assignees={assignees}
        max={TRIGGER_MAX_AVATARS}
        avatarClassName="size-4.5"
        className="-space-x-1"
      />
      <span className="max-w-32 truncate">
        {assignees.length === 1 && assignees[0].name
          ? assignees[0].name
          : t("tasks:popover.assignee.assignedCount", {
              count: assignees.length,
            })}
      </span>
    </>
  );
}

export default TaskAssigneeTriggerContent;
