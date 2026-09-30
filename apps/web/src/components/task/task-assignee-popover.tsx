import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ResourceInviteDialog from "@/components/resource/resource-invite-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import useGetWorkspaceResources from "@/hooks/queries/resource/use-get-workspace-resources";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useProjectPermission } from "@/hooks/use-project-permission";
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
  const { data: workspaceUsers } = useProjectMembers(task.projectId);
  const { data: workspaceResources } = useGetWorkspaceResources(workspaceId);
  const { canAssignTasks, canInviteToProject } = useProjectPermission(
    task.projectId,
  );
  const canAssign = canAssignTasks();
  // Resources are workspace-level: POST /resource is gated by project:update in
  // the WORKSPACE role (no project is resolved for it) — see resource/index.ts.
  const { canUpdateProjects } = useWorkspacePermission();
  const canCreateResource = canUpdateProjects();
  // Inviting a person resource needs the same workspace permission plus
  // invitation:create in the project; the API checks both again.
  const canInviteResource = canCreateResource && canInviteToProject();
  // The person resource whose invite dialog is open. The dialog lives outside
  // the popover so closing the popover does not unmount it.
  const [inviting, setInviting] = useState<Resource | null>(null);

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
    const members = workspaceUsers?.members;
    if (!members) return undefined;
    const options = members.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
      notInProject: false,
    }));
    // Somebody already assigned who is no longer a project member stays in the
    // list, marked, so they can be unassigned.
    const listed = new Set(members.map((member) => member.userId));
    for (const assignee of resolveTaskAssignees(task)) {
      if (!assignee.userId || listed.has(assignee.userId)) continue;
      options.push({
        label: assignee.name || assignee.userId,
        value: assignee.userId,
        image: assignee.image ?? "",
        name: assignee.name,
        notInProject: true,
      });
    }
    return options;
  }, [workspaceUsers, task]);

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

  const handleInviteResource = useCallback((resource: Resource) => {
    setOpen(false);
    setInviting(resource);
  }, []);

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
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
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
                className="w-6 h-6 shrink-0 rounded-full bg-muted border border-border flex items-center justify-center"
                title={t("tasks:popover.assignee.unassigned")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">
                  ?
                </span>
              </div>
              <span className="min-w-0 truncate text-sm">
                {t("tasks:popover.assignee.unassignAll")}
              </span>
              {selectedIds.length === 0 && selectedResourceIds.length === 0 ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : (
                <ShortcutNumber number={1} className="shrink-0" />
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
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="max-w-full truncate text-sm">
                    {user.label}
                  </span>
                  {user.notInProject && (
                    <span className="max-w-full truncate text-[11px] text-muted-foreground">
                      {t("tasks:popover.assignee.notInProject")}
                    </span>
                  )}
                </span>
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
              projectUserIds={
                workspaceUsers?.members?.map((member) => member.userId) ?? []
              }
              assignedResourceIds={resolvedResourceIds}
              selectedResourceIds={selectedResourceIds}
              onToggleResource={handleToggleResource}
              canCreateResource={canCreateResource}
              onInviteResource={
                canInviteResource ? handleInviteResource : undefined
              }
            />
          </div>
        </PopoverContent>
      </Popover>
      {inviting && (
        <ResourceInviteDialog
          resource={inviting}
          workspaceId={workspaceId}
          defaultProjectIds={[task.projectId]}
          // Linking a resource to a member stays on the resources settings page.
          canLink={false}
          onLinkInstead={() => setInviting(null)}
          onClose={() => setInviting(null)}
        />
      )}
    </>
  );
}
