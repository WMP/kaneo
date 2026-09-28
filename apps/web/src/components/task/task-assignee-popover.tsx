import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import useGetWorkspaceResources from "@/hooks/queries/resource/use-get-workspace-resources";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type Resource from "@/types/resource";
import type Task from "@/types/task";
import { resolveTaskAssignees } from "./assignee-avatars";
import { AssigneeResourceSection } from "./assignee-resource-section";

const INITIAL_VISIBLE_USERS = 40;
const VISIBLE_USERS_STEP = 40;

type TaskAssigneePopoverProps = {
  task: Task;
  workspaceId: string;
  children: React.ReactNode;
};

export default function TaskAssigneePopover({
  task,
  workspaceId,
  children,
}: TaskAssigneePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [visibleUsersCount, setVisibleUsersCount] = useState(
    INITIAL_VISIBLE_USERS,
  );
  const { mutateAsync: updateTaskAssignees } = useUpdateTaskAssignees();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: workspaceResources } = useGetWorkspaceResources(
    workspaceId,
  ) as { data: Resource[] | undefined };
  const { canAssignTasks, canUpdateProjects } = useWorkspacePermission();
  const canAssign = canAssignTasks();
  // Gated the same as POST /resource (project:update) — see resource/index.ts.
  const canCreateResource = canUpdateProjects();

  const resolvedAssigneeIds = useMemo(
    () =>
      resolveTaskAssignees(task)
        .map((assignee) => assignee.userId)
        .filter((userId): userId is string => Boolean(userId)),
    [task],
  );

  const resolvedResourceIds = useMemo(
    () =>
      resolveTaskAssignees(task)
        .map((assignee) => assignee.resourceId)
        .filter((resourceId): resourceId is string => Boolean(resourceId)),
    [task],
  );

  // The checked sets, seeded from the task's own assignees (falling back to
  // its single primary assignee) but held locally so a second toggle made
  // while the first mutation is still in flight builds on the pending
  // selection rather than the task prop, which only catches up once the
  // mutation's query invalidation refetches it. resolvedAssigneeIds/
  // resolvedResourceIds only change identity when the task prop itself does
  // (they're memoized on `task`), so re-running this on every change
  // re-syncs exactly when the task changes, not on every render.
  const [selectedIds, setSelectedIds] = useState<string[]>(resolvedAssigneeIds);
  const [selectedResourceIds, setSelectedResourceIds] =
    useState<string[]>(resolvedResourceIds);

  useEffect(() => {
    setSelectedIds(resolvedAssigneeIds);
  }, [resolvedAssigneeIds]);

  useEffect(() => {
    setSelectedResourceIds(resolvedResourceIds);
  }, [resolvedResourceIds]);

  const usersOptions = useMemo(() => {
    return workspaceUsers?.members?.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
    }));
  }, [workspaceUsers]);

  const commitAssignees = useCallback(
    async (nextIds: string[], nextResourceIds: string[]) => {
      const previousIds = selectedIds;
      const previousResourceIds = selectedResourceIds;
      setSelectedIds(nextIds);
      setSelectedResourceIds(nextResourceIds);
      try {
        await updateTaskAssignees({
          taskId: task.id,
          projectId: task.projectId,
          userIds: nextIds,
          resourceIds: nextResourceIds,
        });
      } catch (error) {
        setSelectedIds(previousIds);
        setSelectedResourceIds(previousResourceIds);
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.assignee.updateError"),
        );
      }
    },
    [
      selectedIds,
      selectedResourceIds,
      task.id,
      task.projectId,
      t,
      updateTaskAssignees,
    ],
  );

  const handleToggleUser = useCallback(
    (userId: string) => {
      const next = selectedIds.includes(userId)
        ? selectedIds.filter((id) => id !== userId)
        : [...selectedIds, userId];
      void commitAssignees(next, selectedResourceIds);
    },
    [selectedIds, selectedResourceIds, commitAssignees],
  );

  const handleToggleResource = useCallback(
    (resourceId: string) => {
      const next = selectedResourceIds.includes(resourceId)
        ? selectedResourceIds.filter((id) => id !== resourceId)
        : [...selectedResourceIds, resourceId];
      void commitAssignees(selectedIds, next);
    },
    [selectedIds, selectedResourceIds, commitAssignees],
  );

  const handleUnassignAll = useCallback(() => {
    void commitAssignees([], []);
  }, [commitAssignees]);

  const shortcutOptions = useMemo(() => {
    const unassignedOption = { onSelect: handleUnassignAll };
    const userOptions = (usersOptions || []).slice(0, 8).map((user) => ({
      onSelect: () => handleToggleUser(user.value),
    }));
    return [unassignedOption, ...userOptions];
  }, [usersOptions, handleToggleUser, handleUnassignAll]);

  const visibleUsersOptions = useMemo(() => {
    return usersOptions?.slice(0, visibleUsersCount) ?? [];
  }, [usersOptions, visibleUsersCount]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setVisibleUsersCount(INITIAL_VISIBLE_USERS);
    }
  }, []);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const nearBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight < 48;

      if (!nearBottom) return;

      setVisibleUsersCount((current) => {
        const totalUsers = usersOptions?.length ?? current;
        return Math.min(current + VISIBLE_USERS_STEP, totalUsers);
      });
    },
    [usersOptions?.length],
  );

  useNumberedShortcuts(open, shortcutOptions);

  if (!canAssign) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div
          className="max-h-80 space-y-1 overflow-y-auto p-1"
          onScroll={handleListScroll}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 h-8 px-2"
            onClick={handleUnassignAll}
          >
            <div
              className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
              title={t("tasks:popover.assignee.unassigned")}
            >
              <span className="text-[10px] font-medium text-muted-foreground">
                ?
              </span>
            </div>
            <span className="text-sm">
              {t("tasks:popover.assignee.unassignAll")}
            </span>
            {selectedIds.length === 0 && selectedResourceIds.length === 0 ? (
              <Check className="ml-auto h-4 w-4" />
            ) : (
              <ShortcutNumber number={1} />
            )}
          </Button>
          {visibleUsersOptions.map((user, index) => (
            <Button
              key={user.value}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2"
              onClick={() => handleToggleUser(user.value)}
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.image ?? ""} alt={user.name || ""} />
                <AvatarFallback className="text-xs font-medium border border-border/30">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm truncate">{user.label}</span>
              {selectedIds.includes(user.value) ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : index < 8 ? (
                <ShortcutNumber number={index + 2} />
              ) : null}
            </Button>
          ))}
          <AssigneeResourceSection
            workspaceId={workspaceId}
            resources={workspaceResources ?? []}
            selectedResourceIds={selectedResourceIds}
            onToggleResource={handleToggleResource}
            canCreateResource={canCreateResource}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
