import { useLocation, useParams } from "@tanstack/react-router";
import { produce } from "immer";
import {
  CalendarIcon,
  CircleAlert,
  Check,
  FolderKanban,
  Hourglass,
  Link2,
  Plus,
  Search,
  Tag,
  UserIcon,
  X,
  TagIcon,
  SquarePlusIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomFieldChip } from "@/components/custom-fields/custom-field-chip";
import {
  findMissingRequiredFields,
  isCustomFieldValueEmpty,
} from "@/components/custom-fields/missing-required-fields";
import type { CustomFieldDefinition } from "@/components/project/custom-fields/types";
import ResourceInviteDialog from "@/components/resource/resource-invite-dialog";
import {
  type AssigneeAvatarItem,
  AssigneeAvatars,
} from "@/components/task/assignee-avatars";
import { AssigneeResourceSection } from "@/components/task/assignee-resource-section";
import EstimateEditor from "@/components/task/estimate-editor";
import TaskDescriptionEditor from "@/components/task/task-description-editor";
import type { GanttDependencyType } from "@/components/task/task-relation-dependency-popover";
import TaskRelationPickerDialog, {
  isDependencyRelationType,
  type PickerRelationType,
  type RelationPick,
} from "@/components/task/task-relation-picker";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { DatePickerMenu } from "@/components/common/date-picker/date-picker-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { getColumnIcon } from "@/lib/column";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import useGetWorkspaceResources from "@/hooks/queries/resource/use-get-workspace-resources";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { usePickerSearch } from "@/hooks/use-picker-search";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import {
  type EstimateUnit,
  formatEstimate,
  hasFullDateRange,
  isDateBlockedByEstimate,
} from "@/lib/estimate";
import { uploadDraftAsset } from "@/lib/upload-draft-asset";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { matchesSearch } from "@/lib/search-match";
import { toast } from "@/lib/toast";
import { useAutoGrowTextarea } from "@/hooks/use-auto-grow-textarea";
import { stripLineBreaks } from "@/lib/strip-line-breaks";
import useProjectStore from "@/store/project";
import type Resource from "@/types/resource";
import type Task from "@/types/task";
import { getInitialTaskColumn } from "./initial-task-column";

type CreateTaskModalProps = {
  open: boolean;
  onClose: () => void;
  status?: string;
  projectId?: string;
  instant?: boolean;
};

type Priority = "no-priority" | "low" | "medium" | "high" | "urgent";

type LabelColor =
  | "gray"
  | "dark-gray"
  | "purple"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "pink"
  | "red";

type Label = {
  id: string;
  name: string;
  color: string;
  taskId: string | null;
  workspaceId: string;
  createdAt: string;
};

type PopoverStep = "select" | "color";

// A dependency picked while the task does not exist yet. It is created, with
// the new task's id, right after the task is saved.
type PendingRelation = {
  taskId: string;
  title: string;
  /** "SLUG-12" of the picked task, when known. */
  key: string | null;
  relationType: PickerRelationType;
  dependencyType: GanttDependencyType;
  lagDays: number;
};

const getMemberSearchText = (member: {
  user?: { name?: string | null } | null;
}) => member.user?.name ?? "";
const getProjectSearchText = (project: { name: string; slug?: string }) =>
  `${project.name} ${project.slug ?? ""}`;

function normalizeTask(
  task: Partial<Task> &
    Pick<Task, "id" | "title" | "status" | "projectId" | "createdAt">,
): Task {
  return {
    ...task,
    number: task.number ?? null,
    description: task.description ?? null,
    priority: task.priority ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    progress: task.progress ?? 0,
    isMilestone: task.isMilestone ?? false,
    baselineStartDate: task.baselineStartDate ?? null,
    baselineDueDate: task.baselineDueDate ?? null,
    position: task.position ?? 0,
    userId: task.userId ?? null,
    assigneeId: task.assigneeId ?? task.userId ?? null,
    assigneeName: task.assigneeName ?? null,
    assigneeImage: task.assigneeImage ?? null,
    labels: task.labels ?? [],
    externalLinks: task.externalLinks ?? [],
  };
}

function CreateTaskModalContent({
  open,
  onClose,
  status,
  projectId,
  instant = false,
}: CreateTaskModalProps) {
  const { t } = useTranslation();
  const { project, setProject } = useProjectStore();

  const labelColors = useMemo(
    () =>
      [
        {
          value: "gray" as LabelColor,
          labelKey: "stone" as const,
          color: "var(--color-stone-500)",
        },
        {
          value: "dark-gray" as LabelColor,
          labelKey: "slate" as const,
          color: "var(--color-slate-500)",
        },
        {
          value: "purple" as LabelColor,
          labelKey: "lavender" as const,
          color: "var(--color-violet-500)",
        },
        {
          value: "teal" as LabelColor,
          labelKey: "sage" as const,
          color: "var(--color-emerald-600)",
        },
        {
          value: "green" as LabelColor,
          labelKey: "forest" as const,
          color: "var(--color-green-600)",
        },
        {
          value: "yellow" as LabelColor,
          labelKey: "amber" as const,
          color: "var(--color-amber-600)",
        },
        {
          value: "orange" as LabelColor,
          labelKey: "terracotta" as const,
          color: "var(--color-orange-600)",
        },
        {
          value: "pink" as LabelColor,
          labelKey: "rose" as const,
          color: "var(--color-rose-600)",
        },
        {
          value: "red" as LabelColor,
          labelKey: "crimson" as const,
          color: "var(--color-red-600)",
        },
      ].map(({ labelKey, ...rest }) => ({
        ...rest,
        label: t(`common:modals.createTask.labelColors.${labelKey}`),
      })),
    [t],
  );
  const location = useLocation();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceResources } = useGetWorkspaceResources(
    workspace?.id || "",
  );
  const { mutateAsync: createLabel } = useCreateLabel();
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(
    workspace?.id || "",
  );
  // Resources are workspace-level: POST /resource is gated by project:update in
  // the WORKSPACE role (no project is resolved for it) — see resource/index.ts.
  const { canUpdateProjects } = useWorkspacePermission();
  const canCreateResourceCapability = canUpdateProjects();
  // The person resource whose invite dialog is open, and the assignee picker
  // that is closed to make room for it. The dialog is rendered outside the
  // picker so closing the picker does not unmount it.
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [invitingResource, setInvitingResource] = useState<Resource | null>(
    null,
  );

  const [title, setTitle] = useState("");
  const titleRef = useAutoGrowTextarea(title);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("no-priority");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [resourceAssigneeIds, setResourceAssigneeIds] = useState<string[]>([]);
  // The create endpoint takes one primary assignee; the first selected user
  // fills that role, and the rest (plus every resource) are pushed through the
  // assignees endpoint once the task has an id.
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  // Effort estimate (whole minutes) and the unit it is shown in. A task with
  // an estimate cannot have both dates, so the pickers and this field block
  // each other (see lib/estimate.ts).
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [estimateUnit, setEstimateUnit] = useState<EstimateUnit>("hours");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [pendingRelations, setPendingRelations] = useState<PendingRelation[]>(
    [],
  );
  const [relationPickerOpen, setRelationPickerOpen] = useState(false);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);

  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelsStep, setLabelsStep] = useState<PopoverStep>("select");
  const [searchValue, setSearchValue] = useState("");
  const [selectedColor, setSelectedColor] = useState<LabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");

  const routeProjectId =
    location.pathname.match(/\/project\/([^/]+)/)?.[1] ?? null;
  const explicitProjectId = projectId || routeProjectId || "";
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const { data: workspaceProjects } = useGetProjects({
    workspaceId: workspace?.id || "",
  });
  // Only a project from this workspace's query may receive new content.
  // The global project store can still contain the last visited workspace.
  const resolvedProject = workspaceProjects?.find(
    (candidate) => candidate.id === (explicitProjectId || selectedProjectId),
  );
  const resolvedProjectId = resolvedProject?.id ?? "";
  // Task and label rights and the people to assign are those of the project
  // the task is created in, never the workspace role or the whole workspace
  // list.
  const { data: projectMembers } = useProjectMembers(resolvedProjectId);
  const projectMembersPending =
    Boolean(resolvedProjectId) && projectMembers === undefined;
  const assigneeUnconfirmed = assigneeIds.length > 0 && projectMembersPending;
  const {
    query: assigneeQuery,
    setQuery: setAssigneeQuery,
    isSearching: isSearchingAssignees,
    filtered: filteredMembers,
  } = usePickerSearch(projectMembers?.members, getMemberSearchText);
  const {
    query: projectQuery,
    setQuery: setProjectQuery,
    isSearching: isSearchingProjects,
    filtered: filteredProjects,
  } = usePickerSearch(workspaceProjects, getProjectSearchText);
  const [priorityQuery, setPriorityQuery] = useState("");
  const {
    canCreateTasks,
    canCreateLabels,
    canUpdateTasks,
    canInviteToProject,
    isCheckingPermissions: isCheckingProjectPermissions,
    isError: projectPermissionsFailed,
  } = useProjectPermission(resolvedProjectId);
  // Submitting needs a project and the right to create tasks in it.
  const canCreateTaskCapability = canCreateTasks();
  const canCreateLabelCapability = canCreateLabels();
  // Relations are managed with the same right as in the task's own relations
  // panel (update tasks in the project).
  const canManageRelations = canUpdateTasks();
  // Inviting a person resource needs the workspace permission that creates
  // resources plus invitation:create in the project; the API checks both again.
  const canInviteResourceCapability =
    canCreateResourceCapability && canInviteToProject();
  // The dialog always stays open so another project can be picked. Creating is
  // blocked until the chosen project says yes: while its permissions load, when
  // they cannot be read, and when it does not allow creating tasks.
  const projectBlocksCreating =
    Boolean(resolvedProjectId) &&
    (isCheckingProjectPermissions ||
      projectPermissionsFailed ||
      !canCreateTaskCapability);
  const projectAccessMessage =
    resolvedProjectId && !isCheckingProjectPermissions
      ? projectPermissionsFailed
        ? t("common:modals.createTask.permissionsUnavailable")
        : canCreateTaskCapability
          ? null
          : t("common:modals.createTask.noCreatePermission")
      : null;
  // Only users that are members of the chosen project can be submitted; a
  // selection made under another project is dropped, not sent.
  const selectedUsers = useMemo(
    () =>
      assigneeIds
        .map((id) => projectMembers?.members?.find((u) => u.userId === id))
        .filter((member): member is NonNullable<typeof member> =>
          Boolean(member),
        ),
    [assigneeIds, projectMembers],
  );
  const selectedUserIds = useMemo(
    () => selectedUsers.map((member) => member.userId),
    [selectedUsers],
  );
  const primaryAssigneeId = selectedUserIds[0] ?? "";
  const selectedResources = useMemo(
    () =>
      resourceAssigneeIds
        .map((id) => workspaceResources?.find((r) => r.id === id))
        .filter((resource): resource is Resource => Boolean(resource)),
    [resourceAssigneeIds, workspaceResources],
  );
  const selectedAssigneeAvatars = useMemo<AssigneeAvatarItem[]>(
    () => [
      ...selectedUsers.map((member) => ({
        userId: member.userId,
        name: member.user?.name ?? "",
        image: member.user?.image ?? null,
      })),
      ...selectedResources.map((resource) => ({
        userId: null,
        resourceId: resource.id,
        kind: resource.kind,
        name: resource.name,
        image: null,
      })),
    ],
    [selectedUsers, selectedResources],
  );
  const {
    data: projectColumns,
    isError: columnsError,
    refetch: refetchColumns,
    isFetching: columnsFetching,
  } = useGetColumns(open ? resolvedProjectId : "", { refreshOnMount: true });
  const initialColumn = getInitialTaskColumn(projectColumns, status);
  const taskStatus = status ?? initialColumn?.slug ?? "planned";
  const awaitingColumns =
    !status &&
    Boolean(resolvedProjectId) &&
    (!projectColumns || columnsFetching || columnsError);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const stagedAssetsRef = useRef<string[]>([]);
  const pendingUploadsRef = useRef(0);
  const activeRef = useRef(true);
  const submittingRef = useRef(false);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const didSubmitRef = useRef(false);

  const { mutateAsync: createTask } = useCreateTask();
  const { mutateAsync: updateTaskAssignees } = useUpdateTaskAssignees();
  const { mutateAsync: createTaskRelation } = useCreateTaskRelation();

  const { data: rawCustomFields } = useGetCustomFieldsByProject(
    resolvedProjectId,
  ) as { data: CustomFieldDefinition[] | undefined };

  const customFields = useMemo(() => rawCustomFields ?? [], [rawCustomFields]);

  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, string>
  >({});

  const [showMissingRequired, setShowMissingRequired] = useState(false);
  const missingRequired = findMissingRequiredFields(
    customFields,
    customFieldValues,
  );

  const handleCustomFieldChange = (fieldId: string, value: string) => {
    setCustomFieldValues((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  useEffect(() => {
    setCustomFieldValues((previousValues) =>
      Object.fromEntries(
        customFields.map((field) => [
          field.id,
          previousValues[field.id] ?? field.defaultValue ?? "",
        ]),
      ),
    );
  }, [customFields]);

  const filteredLabels = (() => {
    const searchFiltered = workspaceLabels.filter((label) =>
      matchesSearch(label.name, searchValue),
    );

    const labelMap = new Map<string, (typeof workspaceLabels)[0]>();
    for (const label of searchFiltered) {
      const existing = labelMap.get(label.name);
      if (!existing || (label.taskId === null && existing.taskId !== null)) {
        labelMap.set(label.name, label);
      }
    }

    return Array.from(labelMap.values());
  })();

  const isCreatingNewLabel =
    searchValue &&
    !workspaceLabels.some(
      (label) => label.name.toLowerCase() === searchValue.toLowerCase(),
    );

  const buildDefaultCustomFieldValues = useCallback(() => {
    return customFields.reduce<Record<string, string>>((acc, field) => {
      acc[field.id] = field.defaultValue ?? "";
      return acc;
    }, {});
  }, [customFields]);

  const hasCustomFieldChanges = Object.entries(customFieldValues).some(
    ([fieldId, value]) => {
      const field = customFields.find((f) => f.id === fieldId);
      const defaultValue = field?.defaultValue ?? "";
      return value !== defaultValue;
    },
  );

  // Estimate and a complete date range are mutually exclusive.
  const startDateBlocked = isDateBlockedByEstimate(
    estimateMinutes,
    startDate,
    dueDate,
  );
  const dueDateBlocked = isDateBlockedByEstimate(
    estimateMinutes,
    dueDate,
    startDate,
  );
  const estimateBlocked = hasFullDateRange(startDate, dueDate);
  const exclusiveHint = t("tasks:popover.estimate.exclusiveHint");

  const hasUnsavedChanges = Boolean(
    title.trim() ||
    description.trim() ||
    priority !== "no-priority" ||
    assigneeIds.length > 0 ||
    resourceAssigneeIds.length > 0 ||
    startDate ||
    dueDate ||
    estimateMinutes !== null ||
    selectedProjectId ||
    labels.length > 0 ||
    pendingRelations.length > 0 ||
    stagedAssetsRef.current.length > 0 ||
    hasCustomFieldChanges,
  );

  // Pending dependencies were picked against one project's tasks.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clears when the project changes.
  useEffect(() => {
    setPendingRelations([]);
  }, [resolvedProjectId]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const handleClose = () => {
    activeRef.current = false;

    onClose();
  };

  const closeAndReset = () => {
    setDiscardConfirmationOpen(false);
    handleClose();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;

    if (hasUnsavedChanges && !didSubmitRef.current) {
      setDiscardConfirmationOpen(true);
      return;
    }

    closeAndReset();
  };

  const syncTaskIntoProject = useCallback(
    (task: Task) => {
      if (!activeRef.current || project?.id !== task.projectId) return;

      const updatedProject = produce(project, (draft) => {
        let existingTask:
          | (typeof draft.columns)[number]["tasks"][number]
          | undefined;

        for (const column of draft.columns ?? []) {
          const taskIndex = column.tasks.findIndex(
            (columnTask) => columnTask.id === task.id,
          );

          if (taskIndex !== -1) {
            existingTask = column.tasks[taskIndex];
            column.tasks.splice(taskIndex, 1);
            break;
          }
        }

        if (task.status === "planned" || task.status === "archived") {
          return;
        }

        const targetColumn = draft.columns?.find(
          (column) => column.id === task.status,
        );
        if (!targetColumn) return;

        targetColumn.tasks.push({
          ...existingTask,
          ...task,
          assigneeId: task.userId,
          assigneeName:
            projectMembers?.members?.find(
              (member) => member.userId === task.userId,
            )?.user?.name ??
            existingTask?.assigneeName ??
            null,
          assigneeImage:
            projectMembers?.members?.find(
              (member) => member.userId === task.userId,
            )?.user?.image ??
            existingTask?.assigneeImage ??
            null,
          position: task.position ?? 0,
        });
      });

      setProject(updatedProject);
    },
    [project, setProject, projectMembers?.members],
  );

  const stageAsset = useCallback(
    async (file: File) => {
      if (!activeRef.current || submittingRef.current || !resolvedProjectId) {
        throw new Error(t("common:modals.createTask.chooseProjectForImages"));
      }
      pendingUploadsRef.current += 1;
      setIsPreparingDraft(true);
      try {
        const asset = await uploadDraftAsset(resolvedProjectId, file);
        if (!activeRef.current)
          throw new Error(t("common:modals.createTask.prepareTaskError"));
        stagedAssetsRef.current.push(asset.id);
        return asset;
      } finally {
        pendingUploadsRef.current -= 1;
        if (activeRef.current)
          setIsPreparingDraft(pendingUploadsRef.current > 0);
      }
    },
    [resolvedProjectId, t],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !activeRef.current ||
      submittingRef.current ||
      pendingUploadsRef.current > 0 ||
      projectBlocksCreating ||
      awaitingColumns ||
      !title.trim() ||
      !resolvedProjectId ||
      assigneeUnconfirmed ||
      !workspace?.id
    )
      return;

    if (missingRequired.length > 0) {
      setShowMissingRequired(true);
      e.currentTarget
        .querySelector<HTMLElement>(
          `[data-custom-field="${missingRequired[0].id}"]`,
        )
        ?.focus();
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      let submitStatus = taskStatus;
      if (!status) {
        const workflow = await refetchColumns();
        if (!activeRef.current) return;
        if (workflow.isError || !workflow.data)
          throw new Error(t("common:modals.createTask.statusLoadError"));
        submitStatus = getInitialTaskColumn(workflow.data)?.slug ?? "planned";
      }
      didSubmitRef.current = true;
      const savedTask = normalizeTask(
        await createTask({
          title: title.trim(),
          description: description.trim() || "",
          userId: primaryAssigneeId,
          priority,
          projectId: resolvedProjectId,
          startDate: startDate ? startDate.toISOString() : undefined,
          dueDate: dueDate ? dueDate.toISOString() : undefined,
          ...(estimateMinutes !== null
            ? { estimateMinutes, estimateUnit }
            : {}),
          status: submitStatus,
          draftAssetIds: stagedAssetsRef.current.filter((id) =>
            description.includes(`/asset/${id}`),
          ),
          customFields: customFields
            .filter(
              (field) =>
                !isCustomFieldValueEmpty(
                  field.type,
                  customFieldValues[field.id] ?? "",
                ),
            )
            .map((field) => ({
              fieldId: field.id,
              value: customFieldValues[field.id] ?? "",
            })),
        }),
      );

      // The create endpoint only takes one primary assignee; push the rest
      // (if any were selected), plus every resource assignee, as a second call
      // now that the task has an id.
      if (selectedUserIds.length > 1 || resourceAssigneeIds.length > 0) {
        try {
          await updateTaskAssignees({
            taskId: savedTask.id,
            projectId: savedTask.projectId,
            userIds: selectedUserIds,
            resourceIds: resourceAssigneeIds,
          });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : t("tasks:popover.assignee.updateError"),
          );
        }
      }

      for (const label of labels) {
        try {
          await createLabel({
            name: label.name,
            color: label.color,
            taskId: savedTask.id,
            workspaceId: workspace.id,
          });
        } catch (error) {
          console.error("Failed to create label:", error);
        }
      }

      // The task exists now, so its dependencies can be linked. A failed link
      // (a cycle, a task that was deleted meanwhile, ...) never undoes the
      // task or stops the other links.
      for (const relation of pendingRelations) {
        const isDependency = isDependencyRelationType(relation.relationType);
        try {
          await createTaskRelation({
            // "Blocked by" stores the picked task as the blocker (source).
            sourceTaskId:
              relation.relationType === "blocked_by"
                ? relation.taskId
                : savedTask.id,
            targetTaskId:
              relation.relationType === "blocked_by"
                ? savedTask.id
                : relation.taskId,
            relationType: isDependency ? "blocks" : "related",
            ...(isDependency
              ? {
                  dependencyType: relation.dependencyType,
                  lagDays: relation.lagDays,
                }
              : {}),
          });
        } catch (error) {
          toast.error(
            t("common:modals.createTask.dependencyLinkError", {
              task: relation.key ?? relation.title,
              reason:
                error instanceof Error && error.message
                  ? error.message
                  : t("tasks:relations.linkError"),
            }),
          );
        }
      }

      stagedAssetsRef.current = [];
      if (!activeRef.current) return;
      syncTaskIntoProject(savedTask);
      toast.success(t("common:modals.createTask.successCreated"), {
        icon: SquarePlusIcon,
      });

      if (createMore) {
        setTitle("");
        setDescription("");
        setPriority("no-priority");
        setAssigneeIds([]);
        setResourceAssigneeIds([]);
        setStartDate(undefined);
        setDueDate(undefined);
        setEstimateMinutes(null);
        setEstimateUnit("hours");
        setLabels([]);
        setPendingRelations([]);
        setLabelsStep("select");
        setSearchValue("");
        setSelectedColor("gray");
        setNewLabelName("");
        stagedAssetsRef.current = [];
        setEditorVersion((version) => version + 1);
        didSubmitRef.current = false;

        setCustomFieldValues(buildDefaultCustomFieldValues());
        setShowMissingRequired(false);
      } else {
        closeAndReset();
      }
    } catch (error) {
      didSubmitRef.current = false;
      if (!activeRef.current) {
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.createError"),
      );
    } finally {
      submittingRef.current = false;
      if (activeRef.current) setIsSubmitting(false);
    }
  };

  const priorityOptions = useMemo(
    () =>
      (["no-priority", "low", "medium", "high", "urgent"] as const).map(
        (value) => ({
          value,
          label: t(`tasks:priority.${value}`),
        }),
      ),
    [t],
  );

  const selectedPriority = priorityOptions.find((p) => p.value === priority);
  const visiblePriorityOptions = priorityOptions.filter((option) =>
    matchesSearch(option.label, priorityQuery),
  );

  const statusLabel = getStatusDisplayLabel(taskStatus, initialColumn?.name);
  useEffect(() => {
    if (labelsOpen && labelsStep === "select" && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [labelsOpen, labelsStep]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || discardConfirmationOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (title.trim() && resolvedProjectId && workspace?.id) {
          const form = document.querySelector("form");
          if (form) {
            form.dispatchEvent(
              new Event("submit", { cancelable: true, bubbles: true }),
            );
          }
        }
      }
    },
    [open, discardConfirmationOpen, title, resolvedProjectId, workspace?.id],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const resetLabelsPopover = () => {
    setLabelsStep("select");
    setSearchValue("");
    setNewLabelName("");
    setSelectedColor("gray");
  };

  const handleLabelsClose = () => {
    setLabelsOpen(false);
    setTimeout(resetLabelsPopover, 200);
  };

  const toggleLabel = (labelName: string) => {
    const existingLabel = labels.find((l) => l.name === labelName);
    if (existingLabel) {
      setLabels(labels.filter((l) => l.name !== labelName));
    } else {
      const workspaceLabel = workspaceLabels.find((l) => l.name === labelName);
      if (workspaceLabel) {
        setLabels([
          ...labels,
          {
            id: workspaceLabel.id,
            name: workspaceLabel.name,
            color: workspaceLabel.color,
            taskId: null,
            workspaceId: workspaceLabel.workspaceId || "",
            createdAt: workspaceLabel.createdAt,
          },
        ]);
      }
    }
  };

  const handleCreateNewClick = () => {
    setNewLabelName(searchValue);
    setLabelsStep("color");
  };

  const handleColorSelect = async (color: LabelColor) => {
    setSelectedColor(color);

    if (!newLabelName.trim() || !workspace?.id) return;

    try {
      const createdLabel = await createLabel({
        name: newLabelName.trim(),
        color: color,
        workspaceId: workspace.id,
      });

      const newLabel: Label = {
        id: createdLabel.id,
        name: createdLabel.name,
        color: createdLabel.color,
        taskId: createdLabel.taskId ?? null,
        workspaceId: createdLabel.workspaceId ?? workspace.id,
        createdAt: createdLabel.createdAt,
      };

      setLabels([...labels, newLabel]);
      toast.success(t("common:modals.createTask.labelCreated"), {
        icon: TagIcon,
      });
      handleLabelsClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.labelCreateError"),
      );
    }
  };

  const removeLabel = (labelName: string) => {
    setLabels(labels.filter((l) => l.name !== labelName));
  };

  const handlePickRelation = (pick: RelationPick) => {
    setPendingRelations((current) => [
      ...current,
      {
        taskId: pick.task.id,
        title: pick.task.title,
        key:
          pick.projectSlug && pick.task.number !== null
            ? `${pick.projectSlug}-${pick.task.number}`
            : null,
        relationType: pick.relationType,
        dependencyType: pick.dependencyType,
        lagDays: pick.lagDays,
      },
    ]);
    return true;
  };

  const pendingRelationTaskIds = useMemo(
    () => new Set(pendingRelations.map((relation) => relation.taskId)),
    [pendingRelations],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="kaneo-create-task-modal max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        showCloseButton={false}
        instant={instant}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle asChild>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="text-muted-foreground font-semibold tracking-wider text-sm">
                  {resolvedProject?.slug?.toUpperCase() ||
                    t("common:modals.createTask.breadcrumbTask")}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="text-foreground font-medium text-sm">
                  {t("common:modals.createTask.title")}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common:modals.createTask.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 min-h-0 space-y-6"
        >
          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 px-6">
            <textarea
              ref={titleRef}
              rows={1}
              value={title}
              onChange={(e) => setTitle(stripLineBreaks(e.target.value))}
              onKeyDown={(e) => {
                // Single-line title: Enter submits like the input it replaced.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              autoFocus
              placeholder={t("common:modals.createTask.taskTitlePlaceholder")}
              aria-label={t("common:modals.createTask.taskTitlePlaceholder")}
              className="block w-full resize-none overflow-hidden border-0 bg-transparent px-0 py-3 font-semibold text-2xl text-foreground leading-tight tracking-tight outline-none placeholder:text-muted-foreground"
              required
            />

            <div className="min-h-[200px]">
              <TaskDescriptionEditor
                key={editorVersion}
                value={description}
                onChange={setDescription}
                placeholder={t(
                  "common:modals.createTask.descriptionPlaceholder",
                )}
                projectId={resolvedProjectId || undefined}
                uploadAsset={stageAsset}
              />
            </div>

            {labels.length > 0 && (
              <div className="flex flex-wrap mb-2">
                {labels.map((label) => (
                  <Badge
                    key={label.name}
                    color={label.color}
                    variant="outline"
                    className="flex items-center gap-1 pl-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => removeLabel(label.name)}
                  >
                    <span
                      className="inline-block w-2 h-2 mr-1.5 rounded-full"
                      style={{
                        backgroundColor: resolveLabelColor(label.color),
                      }}
                    />
                    <span className="max-w-20 truncate">{label.name}</span>
                  </Badge>
                ))}
              </div>
            )}

            {pendingRelations.length > 0 && (
              <ul
                className="m-0 flex list-none flex-col gap-1 p-0"
                aria-label={t("common:modals.createTask.dependencies")}
              >
                {pendingRelations.map((relation) => (
                  <li
                    key={`${relation.relationType}:${relation.taskId}`}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {t(`tasks:relations.types.${relation.relationType}`)}
                    </span>
                    {relation.key && (
                      <span className="shrink-0 font-mono text-muted-foreground/80">
                        {relation.key}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {relation.title}
                    </span>
                    {isDependencyRelationType(relation.relationType) && (
                      <span className="shrink-0 rounded border border-border/60 px-1 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground/80">
                        {t(
                          `tasks:relations.dependency.typesShort.${relation.dependencyType}`,
                        )}
                        {relation.lagDays !== 0 &&
                          t("tasks:relations.dependency.lagSuffix", {
                            days:
                              relation.lagDays > 0
                                ? `+${relation.lagDays}`
                                : relation.lagDays,
                          })}
                      </span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive-foreground"
                      aria-label={t(
                        "common:modals.createTask.removeDependency",
                      )}
                      title={t("common:modals.createTask.removeDependency")}
                      onClick={() =>
                        setPendingRelations((current) =>
                          current.filter((item) => item !== relation),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 py-2">
              {!explicitProjectId && (
                <Popover onOpenChange={() => setProjectQuery("")}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                        resolvedProjectId
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <FolderKanban className="w-3.5 h-3.5" />
                      <span>
                        {resolvedProject?.name ||
                          t("common:modals.createTask.selectProject")}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" align="start">
                    <PickerSearchInput
                      value={projectQuery}
                      onValueChange={setProjectQuery}
                      placeholder={t("tasks:picker.search")}
                      onEnter={() => {
                        const first = filteredProjects[0];
                        if (
                          first &&
                          pendingUploadsRef.current === 0 &&
                          stagedAssetsRef.current.length === 0 &&
                          !submittingRef.current
                        ) {
                          setSelectedProjectId(first.id);
                        }
                      }}
                    />
                    <PickerList className="max-h-64 space-y-1 overflow-y-auto p-1">
                      {isSearchingProjects && filteredProjects.length === 0 && (
                        <PickerNoResults>
                          {t("tasks:picker.noResults")}
                        </PickerNoResults>
                      )}
                      {filteredProjects.map((workspaceProject) => (
                        <button
                          key={workspaceProject.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                          disabled={
                            isPreparingDraft ||
                            stagedAssetsRef.current.length > 0 ||
                            isSubmitting
                          }
                          onClick={() => {
                            if (
                              pendingUploadsRef.current === 0 &&
                              stagedAssetsRef.current.length === 0 &&
                              !submittingRef.current
                            ) {
                              setSelectedProjectId(workspaceProject.id);
                            }
                          }}
                        >
                          <span className="text-sm truncate">
                            {workspaceProject.name}
                          </span>
                          {resolvedProjectId === workspaceProject.id && (
                            <Check className="ml-auto h-4 w-4 shrink-0" />
                          )}
                        </button>
                      ))}
                    </PickerList>
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/50 text-foreground rounded-md text-xs font-medium border border-border">
                {getColumnIcon(
                  taskStatus,
                  initialColumn?.isFinal,
                  initialColumn?.icon,
                )}
                {statusLabel}
              </div>

              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={startDateBlocked}
                    title={startDateBlocked ? exclusiveHint : undefined}
                    aria-describedby={
                      startDateBlocked ? "create-task-estimate-hint" : undefined
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                      startDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {startDate
                        ? formatDateMedium(startDate)
                        : t("common:modals.createTask.startDate")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-65 p-0" align="start">
                  <DatePickerMenu
                    label={t("common:modals.createTask.startDate")}
                    placeholder={t("tasks:datePicker.startDatePlaceholder")}
                    clearLabel={t("common:modals.createTask.clearStartDate")}
                    value={startDate ?? null}
                    onChange={(date) => {
                      setStartDate(date ?? undefined);
                      setStartDateOpen(false);
                    }}
                    bounds={dueDate ? { after: dueDate } : undefined}
                    formatLimit={(date) => t("tasks:due.fullDate", { date })}
                  />
                </PopoverContent>
              </Popover>

              <Popover onOpenChange={() => setPriorityQuery("")}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      priority !== "no-priority"
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {getPriorityIcon(priority)}
                    <span>
                      {selectedPriority
                        ? selectedPriority.label
                        : t("common:modals.createTask.priority")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-0" align="start">
                  <PickerSearchInput
                    value={priorityQuery}
                    onValueChange={setPriorityQuery}
                    placeholder={t("tasks:picker.search")}
                    onEnter={() => {
                      const first = visiblePriorityOptions[0];
                      if (first) setPriority(first.value as Priority);
                    }}
                  />
                  <PickerList className="space-y-1 p-1">
                    {priorityQuery.trim() &&
                      visiblePriorityOptions.length === 0 && (
                        <PickerNoResults>
                          {t("tasks:picker.noResults")}
                        </PickerNoResults>
                      )}
                    {visiblePriorityOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                        onClick={() => setPriority(option.value as Priority)}
                      >
                        {getPriorityIcon(option.value)}
                        <span className="text-sm">{option.label}</span>
                        {priority === option.value && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </button>
                    ))}
                  </PickerList>
                </PopoverContent>
              </Popover>

              <Popover
                open={assigneeOpen}
                onOpenChange={(nextOpen) => {
                  setAssigneeOpen(nextOpen);
                  setAssigneeQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      selectedAssigneeAvatars.length > 0
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {selectedAssigneeAvatars.length > 0 ? (
                      <>
                        <AssigneeAvatars
                          assignees={selectedAssigneeAvatars}
                          avatarClassName="h-4 w-4"
                        />
                        <span className="truncate max-w-[8rem]">
                          {selectedAssigneeAvatars.length === 1
                            ? selectedAssigneeAvatars[0].name
                            : t("tasks:boardFilters.selectedCount", {
                                count: selectedAssigneeAvatars.length,
                              })}
                        </span>
                      </>
                    ) : (
                      <>
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>{t("common:modals.createTask.assign")}</span>
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <PickerSearchInput
                    value={assigneeQuery}
                    onValueChange={setAssigneeQuery}
                    placeholder={t("tasks:picker.search")}
                    onEnter={() => {
                      const first = filteredMembers[0];
                      if (!first) return;
                      setAssigneeIds((current) =>
                        current.includes(first.userId)
                          ? current
                          : [...current, first.userId],
                      );
                    }}
                  />
                  <PickerList className="max-h-80 space-y-1 overflow-y-auto p-1">
                    {!isSearchingAssignees && (
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                        onClick={() => {
                          setAssigneeIds([]);
                          setResourceAssigneeIds([]);
                        }}
                      >
                        <div
                          className="w-6 h-6 shrink-0 rounded-full bg-muted border border-border flex items-center justify-center"
                          title={t(
                            "common:modals.createTask.assignUnassignedTitle",
                          )}
                        >
                          <span className="text-[10px] font-medium text-muted-foreground">
                            ?
                          </span>
                        </div>
                        <span className="min-w-0 truncate text-sm">
                          {t("common:modals.createTask.assignUnassigned")}
                        </span>
                        {assigneeIds.length === 0 &&
                          resourceAssigneeIds.length === 0 && (
                            <Check className="ml-auto h-4 w-4 shrink-0" />
                          )}
                      </button>
                    )}
                    {filteredMembers.map((member) => {
                      const isSelected = assigneeIds.includes(member.userId);
                      return (
                        <button
                          key={member.userId}
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                          onClick={() =>
                            setAssigneeIds((current) =>
                              current.includes(member.userId)
                                ? current.filter((id) => id !== member.userId)
                                : [...current, member.userId],
                            )
                          }
                        >
                          <Avatar className="h-6 w-6">
                            <AvatarImage
                              src={member?.user?.image ?? ""}
                              alt={member?.user?.name || ""}
                            />
                            <AvatarFallback className="text-xs font-medium border border-border/30">
                              {getInitials(member?.user?.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 truncate text-sm">
                            {member?.user?.name}
                          </span>
                          {isSelected && (
                            <Check className="ml-auto h-4 w-4 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                    {workspace?.id && (
                      <AssigneeResourceSection
                        workspaceId={workspace.id}
                        resources={workspaceResources ?? []}
                        projectUserIds={
                          projectMembers?.members?.map(
                            (member) => member.userId,
                          ) ?? []
                        }
                        // A task being created has nothing assigned yet; the
                        // section keeps whatever gets selected in the list.
                        selectedResourceIds={resourceAssigneeIds}
                        onToggleResource={(resourceId) =>
                          setResourceAssigneeIds((current) =>
                            current.includes(resourceId)
                              ? current.filter((id) => id !== resourceId)
                              : [...current, resourceId],
                          )
                        }
                        canCreateResource={canCreateResourceCapability}
                        onInviteResource={
                          canInviteResourceCapability
                            ? (resource) => {
                                setAssigneeOpen(false);
                                setInvitingResource(resource);
                              }
                            : undefined
                        }
                        searchQuery={assigneeQuery}
                        noUserMatches={filteredMembers.length === 0}
                      />
                    )}
                  </PickerList>
                </PopoverContent>
              </Popover>

              <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={dueDateBlocked}
                    title={dueDateBlocked ? exclusiveHint : undefined}
                    aria-describedby={
                      dueDateBlocked ? "create-task-estimate-hint" : undefined
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                      dueDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {dueDate
                        ? formatDateMedium(dueDate)
                        : t("common:modals.createTask.dueDate")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-65 p-0" align="start">
                  <DatePickerMenu
                    label={t("common:modals.createTask.dueDate")}
                    placeholder={t("tasks:datePicker.dueDatePlaceholder")}
                    clearLabel={t("common:modals.createTask.clearDueDate")}
                    value={dueDate ?? null}
                    onChange={(date) => {
                      setDueDate(date ?? undefined);
                      setDueDateOpen(false);
                    }}
                    bounds={startDate ? { before: startDate } : undefined}
                    formatLimit={(date) =>
                      t("tasks:datePicker.startsOn", { date })
                    }
                  />
                </PopoverContent>
              </Popover>

              <Popover open={estimateOpen} onOpenChange={setEstimateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={estimateBlocked}
                    title={
                      estimateBlocked
                        ? t("tasks:popover.estimate.blockedByDates")
                        : undefined
                    }
                    aria-label={t("tasks:popover.estimate.label")}
                    aria-describedby={
                      estimateBlocked ? "create-task-estimate-hint" : undefined
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                      estimateMinutes !== null
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Hourglass className="w-3.5 h-3.5" />
                    <span>
                      {estimateMinutes !== null
                        ? formatEstimate(estimateMinutes, estimateUnit, t)
                        : t("tasks:properties.estimate")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  {estimateOpen && (
                    <EstimateEditor
                      minutes={estimateMinutes}
                      unit={estimateUnit}
                      onSave={(minutes, unit) => {
                        setEstimateMinutes(minutes);
                        setEstimateUnit(unit);
                      }}
                      disabled={estimateBlocked}
                      disabledHint={t("tasks:popover.estimate.blockedByDates")}
                      hint={exclusiveHint}
                    />
                  )}
                </PopoverContent>
              </Popover>

              {resolvedProjectId && canManageRelations && (
                <button
                  type="button"
                  onClick={() => setRelationPickerOpen(true)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                    pendingRelations.length > 0
                      ? "bg-accent/30 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>{t("common:modals.createTask.dependencies")}</span>
                  {pendingRelations.length > 0 && (
                    <span className="text-muted-foreground">
                      {pendingRelations.length}
                    </span>
                  )}
                </button>
              )}

              <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      labels.length > 0
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>{t("common:modals.createTask.labels")}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  {labelsStep === "select" && (
                    <div className="w-auto">
                      <div className="flex items-center gap-2 p-2 border-b border-border">
                        <Search className="w-3 h-3 text-muted-foreground" />
                        <input
                          ref={searchInputRef}
                          value={searchValue}
                          onChange={(e) => setSearchValue(e.target.value)}
                          placeholder={t(
                            "common:modals.createTask.searchLabels",
                          )}
                          className="w-full bg-transparent border-none text-foreground text-base focus:outline-none placeholder:text-muted-foreground sm:text-xs"
                        />
                      </div>

                      <div className="py-1">
                        {filteredLabels.length === 0 &&
                          searchValue.length === 0 && (
                            <span className="text-xs text-muted-foreground px-2">
                              {t("common:modals.createTask.noLabelsFound")}
                            </span>
                          )}
                        {filteredLabels.map((label) => (
                          <button
                            key={label.id}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={() => toggleLabel(label.name)}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              {labels.some((l) => l.name === label.name) && (
                                <Check className="w-3 h-3" />
                              )}
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: resolveLabelColor(label.color),
                              }}
                            />
                            <span className="max-w-20 truncate">
                              {label.name}
                            </span>
                          </button>
                        ))}

                        {canCreateLabelCapability &&
                          isCreatingNewLabel &&
                          filteredLabels.length > 0 && (
                            <div className="border-t border-border my-1" />
                          )}
                        {canCreateLabelCapability && isCreatingNewLabel && (
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={handleCreateNewClick}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              <Plus className="w-3 h-3" />
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor:
                                  labelColors.find(
                                    (c) => c.value === selectedColor,
                                  )?.color || "var(--color-neutral-400)",
                              }}
                            />
                            <span className="truncate">
                              {t("common:modals.createTask.createLabel", {
                                name: searchValue,
                              })}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {labelsStep === "color" && (
                    <div className="w-auto">
                      <div className="flex items-center justify-between p-2 border-b border-border">
                        <span className="text-xs font-medium">
                          {t("common:modals.createTask.chooseColor")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLabelsStep("select")}
                          className="w-4 h-4 flex items-center justify-center hover:bg-accent/50 rounded"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="py-1">
                        {labelColors.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left",
                              selectedColor === color.value && "bg-accent/30",
                            )}
                            onClick={() =>
                              handleColorSelect(color.value as LabelColor)
                            }
                          >
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color.color }}
                            />
                            <span className="truncate">{color.label}</span>
                            {selectedColor === color.value && (
                              <Check className="w-3 h-3 ml-auto" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              {customFields.length > 0 && (
                <div className="flex w-full flex-wrap items-center gap-2">
                  {customFields.map((field) => (
                    <CustomFieldChip
                      key={field.id}
                      field={field}
                      value={customFieldValues[field.id] ?? ""}
                      onChange={(value) =>
                        handleCustomFieldChange(field.id, value)
                      }
                      invalid={
                        showMissingRequired &&
                        missingRequired.some(({ id }) => id === field.id)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
            {(estimateMinutes !== null || estimateBlocked) && (
              <p
                id="create-task-estimate-hint"
                className="m-0 pb-2 text-xs text-muted-foreground"
              >
                {estimateBlocked
                  ? t("tasks:popover.estimate.blockedByDates")
                  : exclusiveHint}
              </p>
            )}
          </div>

          {projectAccessMessage && (
            <p
              role="alert"
              className="flex-shrink-0 border-t border-border px-6 py-2 text-xs text-destructive"
            >
              {projectAccessMessage}
            </p>
          )}

          {awaitingColumns && columnsError && (
            <div
              role="alert"
              className="flex items-center gap-2 px-6 py-2 text-sm text-muted-foreground"
            >
              {t("common:modals.createTask.statusLoadError")}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refetchColumns()}
              >
                {t("common:error.tryAgain")}
              </Button>
            </div>
          )}
          <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4">
            <div className="flex items-center gap-3 mr-auto">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={createMore}
                  onChange={(e) => setCreateMore(e.target.checked)}
                  className="rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-0 focus:ring-2 transition-[border-color,box-shadow]"
                />
                {t("common:modals.createTask.createMore")}
              </label>
            </div>

            {showMissingRequired && missingRequired.length > 0 && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-destructive-foreground text-xs"
              >
                <CircleAlert aria-hidden="true" className="size-3.5" />
                {t("tasks:customFields.missingRequired", {
                  count: missingRequired.length,
                })}
              </p>
            )}
            <Button
              type="button"
              onClick={() => handleOpenChange(false)}
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-accent"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !title.trim() ||
                !resolvedProjectId ||
                projectBlocksCreating ||
                assigneeUnconfirmed ||
                isSubmitting ||
                awaitingColumns ||
                isPreparingDraft
              }
              aria-busy={isPreparingDraft || isSubmitting}
              size="sm"
              className="disabled:opacity-50"
            >
              {isPreparingDraft
                ? t("activity:comment.editor.uploadingFile")
                : t("common:modals.createTask.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Outside the form: the picker is portaled, and its clicks and keys
          must never reach the task form. */}
      {resolvedProjectId && workspace?.id && (
        <TaskRelationPickerDialog
          open={relationPickerOpen}
          onOpenChange={setRelationPickerOpen}
          projectId={resolvedProjectId}
          workspaceId={workspace.id}
          excludedTaskIds={pendingRelationTaskIds}
          onPick={handlePickRelation}
        />
      )}

      <AlertDialog
        open={discardConfirmationOpen}
        onOpenChange={setDiscardConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:modals.createTask.discardTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("common:modals.createTask.discardDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" size="sm" />}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={closeAndReset}
            >
              {t("common:modals.createTask.discardButton")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {invitingResource && workspace?.id && (
        <ResourceInviteDialog
          resource={invitingResource}
          workspaceId={workspace.id}
          defaultProjectIds={resolvedProjectId ? [resolvedProjectId] : []}
          // Linking a resource to a member stays on the resources settings page.
          canLink={false}
          onLinkInstead={() => setInvitingResource(null)}
          onClose={() => setInvitingResource(null)}
        />
      )}
    </Dialog>
  );
}

function CreateTaskModal(props: CreateTaskModalProps) {
  const { data: workspace } = useActiveWorkspace();
  const location = useLocation();
  const routeWorkspaceId = useParams({
    strict: false,
    select: (params) =>
      "workspaceId" in params && typeof params.workspaceId === "string"
        ? params.workspaceId
        : undefined,
  });
  // useActiveWorkspace may temporarily fall back to the previous organization
  // while the new route's organization list is loading.
  if (!props.open || (routeWorkspaceId && routeWorkspaceId !== workspace?.id))
    return null;

  // Closing or navigating ends the whole editing session, including pending
  // upload drafts, instead of carrying confidential fields into a new context.
  return (
    <CreateTaskModalContent
      key={JSON.stringify([workspace?.id, location.pathname, props.projectId])}
      {...props}
    />
  );
}

export default CreateTaskModal;
