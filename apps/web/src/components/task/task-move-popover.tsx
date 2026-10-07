import { useNavigate } from "@tanstack/react-router";
import { ArrowRightLeft, Check } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMoveTask } from "@/hooks/mutations/task/use-move-task";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { usePickerSearch } from "@/hooks/use-picker-search";
import { cn } from "@/lib/cn";
import { getStatusLabel } from "@/lib/i18n/domain";
import type Task from "@/types/task";

const getProjectSearchText = (project: { name: string; slug?: string }) =>
  `${project.name} ${project.slug ?? ""}`;

type TaskMovePopoverProps = {
  task: Task;
  workspaceId: string;
  triggerClassName?: string;
};

export default function TaskMovePopover({
  task,
  workspaceId,
  triggerClassName,
}: TaskMovePopoverProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const { data: projects = [] } = useGetProjects({ workspaceId });
  const { mutateAsync: moveTask, isPending: isMovePending } = useMoveTask();
  const destinationProjectId = selectedProjectId || "";
  const {
    data: destinationProject,
    isLoading: isProjectLoading,
    isError: isProjectError,
  } = useGetTasks(destinationProjectId);

  const destinationProjects = useMemo(
    () => projects.filter((project) => project.id !== task.projectId),
    [projects, task.projectId],
  );

  const {
    query: projectQuery,
    setQuery: setProjectQuery,
    isSearching: isSearchingProjects,
    filtered: filteredProjects,
  } = usePickerSearch(destinationProjects, getProjectSearchText);

  const destinationColumns = destinationProject?.columns ?? [];
  const canKeepCurrentStatus = destinationColumns.some(
    (column) => column.id === task.status,
  );
  const fallbackStatus = destinationColumns[0]?.id ?? "";
  const effectiveStatus = canKeepCurrentStatus
    ? task.status
    : selectedStatus || fallbackStatus;

  const selectedStatusLabel = useMemo(() => {
    if (!effectiveStatus || destinationColumns.length === 0) return null;
    const column = destinationColumns.find((c) => c.id === effectiveStatus);
    return column?.name || getStatusLabel(effectiveStatus) || null;
  }, [destinationColumns, effectiveStatus]);

  useEffect(() => {
    if (!open) {
      setSelectedProjectId("");
      setSelectedStatus("");
      setProjectQuery("");
    }
  }, [open, setProjectQuery]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedStatus("");
      return;
    }

    if (canKeepCurrentStatus) {
      setSelectedStatus(task.status);
      return;
    }

    setSelectedStatus(fallbackStatus);
  }, [canKeepCurrentStatus, fallbackStatus, selectedProjectId, task.status]);

  const handleMove = async () => {
    if (!selectedProjectId || !effectiveStatus) return;

    try {
      const result = await moveTask({
        taskId: task.id,
        destinationProjectId: selectedProjectId,
        destinationStatus: effectiveStatus,
      });

      setOpen(false);
      startTransition(() => {
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
          params: {
            workspaceId,
            projectId: result.task.projectId,
            taskId: task.id,
          },
        });
      });
    } catch {
      // toast is handled by useMoveTask's onError
    }
  };

  if (destinationProjects.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("text-foreground", triggerClassName)}
          title={t("tasks:move.title")}
          aria-label={t("tasks:move.title")}
        >
          <ArrowRightLeft className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end" sideOffset={4}>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">
            {t("tasks:move.title")}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("tasks:move.projectLabel")}
            </Label>
            <div className="overflow-hidden rounded-md border border-border">
              <PickerSearchInput
                value={projectQuery}
                onValueChange={setProjectQuery}
                placeholder={t("tasks:picker.search")}
                onEnter={() => {
                  const first = filteredProjects[0];
                  if (first) setSelectedProjectId(first.id);
                }}
              />
              <PickerList className="max-h-40 overflow-y-auto p-1">
                {isSearchingProjects && filteredProjects.length === 0 && (
                  <PickerNoResults>
                    {t("tasks:picker.noResults")}
                  </PickerNoResults>
                )}
                {filteredProjects.map((project) => (
                  <Button
                    key={project.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2"
                    aria-pressed={project.id === selectedProjectId}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span className="min-w-0 truncate text-sm">
                      {project.name}
                    </span>
                    {project.id === selectedProjectId && (
                      <Check className="ml-auto h-4 w-4 shrink-0" />
                    )}
                  </Button>
                ))}
              </PickerList>
            </div>
          </div>

          {selectedProjectId && isProjectLoading && (
            <div className="flex items-center justify-center py-2">
              <span className="text-xs text-muted-foreground">
                {t("tasks:move.statusLabel")}…
              </span>
            </div>
          )}

          {selectedProjectId && isProjectError && (
            <p className="text-xs text-destructive">{t("tasks:move.error")}</p>
          )}

          {selectedProjectId &&
            !isProjectLoading &&
            !isProjectError &&
            destinationColumns.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t("tasks:move.statusLabel")}
                </Label>
                <Select
                  value={effectiveStatus || undefined}
                  onValueChange={(value) =>
                    setSelectedStatus(String(value ?? ""))
                  }
                  disabled={canKeepCurrentStatus}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{selectedStatusLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {destinationColumns.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.name || getStatusLabel(column.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {canKeepCurrentStatus
                    ? t("tasks:move.statusHintKeep")
                    : t("tasks:move.statusHintAdjust")}
                </p>
              </div>
            )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleMove()}
            disabled={
              !selectedProjectId ||
              !effectiveStatus ||
              isMovePending ||
              isPending ||
              isProjectLoading ||
              isProjectError
            }
            className="w-full font-medium"
          >
            {t("tasks:move.action")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
