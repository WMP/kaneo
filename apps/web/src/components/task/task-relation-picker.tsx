import { Link2, Lock, Search, X } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { getColumnIcon } from "@/lib/column";
import type { GanttDependencyType } from "./task-relation-dependency-popover";
import {
  buildCrossProjectTaskGroups,
  isOtherProjectItem,
  type PickerTaskGroup as TaskGroup,
  type PickerTaskItem as TaskItem,
} from "./task-relations-cross-project";

export const DEPENDENCY_TYPES: GanttDependencyType[] = ["fs", "ss", "ff", "sf"];

// What the picker creates when a task is chosen. "blocked_by" is the same
// "blocks" relation as "blocks" with the two ends swapped: the picked task is
// the source (the blocker) and the current task is the target.
export type PickerRelationType = "related" | "blocks" | "blocked_by";

export const RELATION_TYPE_OPTIONS: Array<{
  type: PickerRelationType;
  icon: typeof Link2;
  labelKey: string;
}> = [
  { type: "related", icon: Link2, labelKey: "tasks:relations.related" },
  { type: "blocks", icon: X, labelKey: "tasks:relations.blocks" },
  { type: "blocked_by", icon: Lock, labelKey: "tasks:relations.blockedBy" },
];

// A workspace can hold far more tasks than any one project, so the
// cross-project half of the picker is server-searched (via the existing
// global search endpoint, scoped to this workspace) rather than loaded
// client-side. This threshold keeps that request off single keystrokes.
const CROSS_PROJECT_SEARCH_MIN_CHARS = 2;

/** What the person chose in the picker: a task, how it relates, and (for a
 * "blocks"/"blocked_by" relation) the dependency type and lag in days. */
export type RelationPick = {
  task: TaskItem;
  /** The task's project slug (its own for another project, else the current one's). */
  projectSlug?: string;
  relationType: PickerRelationType;
  dependencyType: GanttDependencyType;
  lagDays: number;
};

export function isDependencyRelationType(type: PickerRelationType): boolean {
  return type === "blocks" || type === "blocked_by";
}

type TaskRelationPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project of the task the relation starts from. */
  projectId: string;
  workspaceId: string;
  /** Tasks that cannot be picked: the task itself and tasks already linked. */
  excludedTaskIds: ReadonlySet<string>;
  /** Resolves true to close the picker; false keeps it open (e.g. on error). */
  onPick: (pick: RelationPick) => boolean | Promise<boolean>;
};

/**
 * The "link a task" picker: choose a relation kind (with dependency type and
 * lag for "blocks"/"blocked by"), then search tasks of the project and, by
 * server search, of the other projects of the workspace. It only reports the
 * choice; the caller decides what to do with it (create the relation now, or
 * keep it until a new task exists).
 */
export default function TaskRelationPickerDialog({
  open,
  onOpenChange,
  ...props
}: TaskRelationPickerDialogProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <TaskRelationPickerContent
          {...props}
          close={() => onOpenChange(false)}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

// Mounted only while the dialog is open, so its queries and state (query,
// kind, dependency settings) start fresh every time the picker opens.
function TaskRelationPickerContent({
  projectId,
  workspaceId,
  excludedTaskIds,
  onPick,
  close,
}: Omit<TaskRelationPickerDialogProps, "open" | "onOpenChange"> & {
  close: () => void;
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  // No kind is preselected: the user picks one first, and only then does the
  // task search become usable.
  const [selectedRelationType, setSelectedRelationType] =
    useState<PickerRelationType | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Only meaningful once selectedRelationType is "blocks" or "blocked_by".
  const [newDependencyType, setNewDependencyType] =
    useState<GanttDependencyType>("fs");
  const [newLagDaysInput, setNewLagDaysInput] = useState("0");

  const { data: projectData } = useGetTasks(projectId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });

  const trimmedSearchQuery = searchQuery.trim();
  const { data: crossProjectSearch } = useGlobalSearch({
    q:
      trimmedSearchQuery.length >= CROSS_PROJECT_SEARCH_MIN_CHARS
        ? trimmedSearchQuery
        : "",
    type: "tasks",
    workspaceId,
    // Excluded server-side so a query that matches 20+ tasks in the current
    // project doesn't crowd out the other-project matches this group exists
    // to surface (the current project already has its own group above).
    excludeProjectId: projectId,
    limit: 20,
  });

  const allTasks = useMemo(() => {
    if (!projectData) return [];
    const tasks: TaskItem[] = [];

    if ("columns" in projectData && Array.isArray(projectData.columns)) {
      for (const col of projectData.columns as Array<{
        tasks: TaskItem[];
      }>) {
        if (col.tasks) {
          for (const task of col.tasks) {
            tasks.push(task);
          }
        }
      }
    }

    return tasks;
  }, [projectData]);

  const columnIconBySlug = useMemo(() => {
    const icons = new Map<string, string | null | undefined>();
    if (!projectData) return icons;
    if ("columns" in projectData && Array.isArray(projectData.columns)) {
      for (const col of projectData.columns as Array<{
        id: string;
        icon?: string | null;
      }>) {
        icons.set(col.id, col.icon);
      }
    }
    return icons;
  }, [projectData]);

  const filteredTasks = allTasks.filter(
    (task) => !excludedTaskIds.has(task.id),
  );

  const crossProjectGroups = useMemo<TaskGroup[]>(() => {
    const results = crossProjectSearch?.results ?? [];
    if (results.length === 0) return [];

    return buildCrossProjectTaskGroups({
      results,
      currentProjectId: projectId,
      excludedTaskIds,
      labelForProject: (projectName) =>
        t("tasks:relations.tasksInOtherProject", { project: projectName }),
    });
  }, [crossProjectSearch, projectId, excludedTaskIds, t]);

  const commandGroups = useMemo<TaskGroup[]>(() => {
    return [
      {
        value: "tasks",
        label: t("tasks:relations.tasksInProject"),
        items: filteredTasks,
      },
      ...crossProjectGroups,
    ];
  }, [filteredTasks, crossProjectGroups, t]);

  const handleSelectRelationType = (type: PickerRelationType) => {
    setSelectedRelationType(type);
    // The search input is disabled until a kind is chosen; wait for the
    // re-render that enables it before moving focus there.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const handleLinkTask = async (item: TaskItem) => {
    if (selectedRelationType === null) return;
    const parsedLagDays = Number.parseInt(newLagDaysInput, 10);
    const shouldClose = await onPick({
      task: item,
      projectSlug: item.projectSlug ?? project?.slug,
      relationType: selectedRelationType,
      dependencyType: newDependencyType,
      lagDays: Number.isNaN(parsedLagDays) ? 0 : parsedLagDays,
    });
    if (shouldClose) close();
  };

  const hasRelationType = selectedRelationType !== null;

  return (
    <Command items={commandGroups} disabled={!hasRelationType}>
      <div className="flex flex-col gap-2 border-b px-3 py-2.5">
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="sr-only">
            {t("tasks:relations.typeGroupLabel")}
          </legend>
          <div className="flex items-center gap-1.5">
            {RELATION_TYPE_OPTIONS.map(({ type, icon: Icon, labelKey }) => (
              <button
                key={type}
                type="button"
                aria-pressed={selectedRelationType === type}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRelationType === type ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => handleSelectRelationType(type)}
              >
                <Icon className="size-3" />
                {t(labelKey)}
              </button>
            ))}
          </div>
          {!hasRelationType && (
            <p className="text-xs text-muted-foreground/80">
              {t("tasks:relations.chooseTypeFirst")}
            </p>
          )}
        </fieldset>

        {/* Dependency type/lag only apply to a "blocks" relation (either
            direction) — the Gantt's scheduling dependency; a plain "related"
            link has no ordering to configure. */}
        {selectedRelationType !== null &&
          isDependencyRelationType(selectedRelationType) && (
            <div className="flex items-center gap-2">
              <Select
                value={newDependencyType}
                onValueChange={(value) =>
                  setNewDependencyType(String(value) as GanttDependencyType)
                }
              >
                <SelectTrigger className="h-7 min-w-0 flex-1 text-xs" size="sm">
                  <SelectValue>
                    {t(`tasks:relations.dependency.types.${newDependencyType}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DEPENDENCY_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`tasks:relations.dependency.types.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="number"
                value={newLagDaysInput}
                onChange={(e) => setNewLagDaysInput(e.target.value)}
                placeholder="0"
                aria-label={t("tasks:relations.dependency.lagLabel")}
                className="h-7 w-16 shrink-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring"
              />
              <span className="shrink-0 text-[11px] text-muted-foreground/60">
                {t("tasks:relations.dependency.lagLabel")}
              </span>
            </div>
          )}
      </div>
      <CommandInput
        ref={searchInputRef}
        autoFocus={false}
        disabled={!hasRelationType}
        placeholder={t("tasks:relations.searchPlaceholder")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <CommandPanel>
        <div
          aria-disabled={!hasRelationType}
          className={
            hasRelationType
              ? undefined
              : "pointer-events-none select-none opacity-50"
          }
        >
          <CommandEmpty>
            <div className="text-center py-6">
              <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("tasks:relations.noTasksFound")}
              </p>
            </div>
          </CommandEmpty>
          <CommandList>
            {(group: TaskGroup, groupIndex: number) => (
              <Fragment key={group.value}>
                <CommandGroup items={group.items}>
                  <CommandGroupLabel>{group.label}</CommandGroupLabel>
                  <CommandCollection>
                    {(item: TaskItem) => {
                      // Cross-project items carry their own project slug;
                      // same-project items fall back to the current project.
                      const slug = item.projectSlug ?? project?.slug;
                      const isOtherProject = isOtherProjectItem(
                        item,
                        projectId,
                      );
                      return (
                        <CommandItem
                          key={item.id}
                          value={`${slug}-${item.number} ${item.title} ${item.description ?? ""}`}
                          disabled={!hasRelationType}
                          onClick={() => handleLinkTask(item)}
                          className="flex items-center gap-3 py-2"
                        >
                          {getColumnIcon(
                            item.status,
                            false,
                            isOtherProject
                              ? undefined
                              : columnIconBySlug.get(item.status),
                          )}
                          <span className="text-xs text-muted-foreground shrink-0 font-mono">
                            {slug}-{item.number}
                          </span>
                          <span className="text-sm truncate flex-1">
                            {item.title}
                          </span>
                        </CommandItem>
                      );
                    }}
                  </CommandCollection>
                </CommandGroup>
                {groupIndex < commandGroups.length - 1 && <CommandSeparator />}
              </Fragment>
            )}
          </CommandList>
        </div>
      </CommandPanel>
      <CommandFooter>
        <span className="text-muted-foreground/60">
          {t("tasks:relations.selectTask")}
        </span>
      </CommandFooter>
    </Command>
  );
}
