import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  PickerList,
  PickerNoResults,
  PickerSearchInput,
} from "@/components/ui/picker-search-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskAssignee } from "@/hooks/mutations/task/use-update-task-assignee";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { usePickerSearch } from "@/hooks/use-picker-search";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const INITIAL_VISIBLE_USERS = 40;

const getUserSearchText = (user: { label: string; name: string }) =>
  `${user.label} ${user.name}`;
const VISIBLE_USERS_STEP = 40;

type SubtaskAssigneePopoverProps = {
  tasks: Task[];
  children: React.ReactNode;
};

export default function SubtaskAssigneePopover({
  tasks,
  children,
}: SubtaskAssigneePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [visibleUsersCount, setVisibleUsersCount] = useState(
    INITIAL_VISIBLE_USERS,
  );
  const { mutateAsync: updateTaskAssignee } = useUpdateTaskAssignee();
  const { data: workspaceUsers } = useProjectMembers(tasks[0]?.projectId);
  const { canAssignTasks } = useProjectPermission(tasks[0]?.projectId);
  const canAssign = canAssignTasks();

  const usersOptions = useMemo(() => {
    return workspaceUsers?.members?.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
    }));
  }, [workspaceUsers]);

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    isSearching,
    filtered: filteredUsersOptions,
  } = usePickerSearch(usersOptions, getUserSearchText);

  const allSameAssignee =
    tasks.length > 0 && tasks.every((t) => t.userId === tasks[0].userId);
  const currentAssignee = allSameAssignee ? tasks[0].userId : null;

  const handleAssigneeChange = useCallback(
    async (newUserId: string) => {
      try {
        await Promise.all(
          tasks.map((task) =>
            updateTaskAssignee({
              ...task,
              userId: newUserId,
            }),
          ),
        );
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.assignee.updateError"),
        );
      }
    },
    [t, tasks, updateTaskAssignee],
  );

  const shortcutOptions = useMemo(() => {
    // The numbers follow the list on screen: "Unassigned" is 1 only while it
    // is shown (no search), then the first filtered people.
    const unassignedOption = isSearching
      ? []
      : [{ onSelect: () => handleAssigneeChange("") }];
    const userOptions = filteredUsersOptions.slice(0, 8).map((user) => ({
      onSelect: () => handleAssigneeChange(user.value),
    }));
    return [...unassignedOption, ...userOptions];
  }, [filteredUsersOptions, isSearching, handleAssigneeChange]);

  // Filtering runs over every member; only the rendered slice is incremental.
  const visibleUsersOptions = useMemo(() => {
    return filteredUsersOptions.slice(0, visibleUsersCount);
  }, [filteredUsersOptions, visibleUsersCount]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      setSearchQuery("");
      if (nextOpen) {
        setVisibleUsersCount(INITIAL_VISIBLE_USERS);
      }
    },
    [setSearchQuery],
  );

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const nearBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight < 48;

      if (!nearBottom) return;

      setVisibleUsersCount((current) => {
        const totalUsers = filteredUsersOptions.length || current;
        return Math.min(current + VISIBLE_USERS_STEP, totalUsers);
      });
    },
    [filteredUsersOptions.length],
  );

  useNumberedShortcuts(open, shortcutOptions);

  if (!canAssign) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <PickerSearchInput
          value={searchQuery}
          onValueChange={(value) => {
            setSearchQuery(value);
            setVisibleUsersCount(INITIAL_VISIBLE_USERS);
          }}
          placeholder={t("tasks:picker.search")}
          onEnter={() => {
            const first = filteredUsersOptions[0];
            if (first) void handleAssigneeChange(first.value);
          }}
        />
        <PickerList
          className="max-h-80 space-y-1 overflow-y-auto p-1"
          onScroll={handleListScroll}
        >
          {!isSearching && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2"
              onClick={() => handleAssigneeChange("")}
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
                {t("tasks:popover.assignee.unassigned")}
              </span>
              {allSameAssignee && !currentAssignee ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : (
                <ShortcutNumber number={1} className="shrink-0" />
              )}
            </Button>
          )}
          {isSearching && filteredUsersOptions.length === 0 && (
            <PickerNoResults>{t("tasks:picker.noResults")}</PickerNoResults>
          )}
          {visibleUsersOptions.map((user, index) => (
            <Button
              key={user.value}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2"
              onClick={() => handleAssigneeChange(user.value)}
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.image ?? ""} alt={user.name || ""} />
                <AvatarFallback className="text-xs font-medium border border-border/30">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm truncate">{user.label}</span>
              {currentAssignee === user.value ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : index < 8 ? (
                <ShortcutNumber number={index + (isSearching ? 1 : 2)} />
              ) : null}
            </Button>
          ))}
        </PickerList>
      </PopoverContent>
    </Popover>
  );
}
