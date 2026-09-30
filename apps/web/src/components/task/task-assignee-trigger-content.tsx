import { useTranslation } from "react-i18next";
import type { AssigneeProfile } from "@/lib/find-assignee";
import type Task from "@/types/task";
import { AssigneeAvatars, resolveTaskAssignees } from "./assignee-avatars";

type TaskAssigneeTriggerContentProps = {
  task: Task;
  /** The project member behind `task.userId`, when still listed: their current
   * name and image win over the ones the task carries. */
  assignee?: AssigneeProfile;
};

/** What the assignee trigger button of the task sidebar shows: the avatars of
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
        <div
          className="w-[16px] h-[16px] rounded-full bg-muted border border-border flex items-center justify-center shrink-0"
          title={t("tasks:popover.assignee.unassigned")}
        >
          <span className="text-[8px] font-medium">?</span>
        </div>
        <span className="text-xs font-semibold truncate max-w-[100px]">
          {t("tasks:popover.assignee.unassigned")}
        </span>
      </>
    );
  }

  return (
    <>
      <AssigneeAvatars assignees={assignees} avatarClassName="size-4" />
      <span className="text-xs font-semibold truncate max-w-[100px]">
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
