import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import useReplaceTaskVms from "@/hooks/mutations/infrastructure/use-replace-task-vms";
import useProjectCapacity from "@/hooks/queries/infrastructure/use-project-capacity";
import useProjectHosts from "@/hooks/queries/infrastructure/use-project-hosts";
import useProjectModels from "@/hooks/queries/infrastructure/use-project-models";
import useProjectStorageClusters from "@/hooks/queries/infrastructure/use-project-storage-clusters";
import useTaskVms from "@/hooks/queries/infrastructure/use-task-vms";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { toast } from "@/lib/toast";
import { InfrastructureWarningList } from "../infrastructure-warning-list";
import { VmListEditor } from "./vm-list-editor";
import {
  rowsFromVms,
  rowsSignature,
  toVmInputs,
  type VmRow,
  validateRow,
} from "./vm-rows";

type Props = {
  taskId: string;
  projectId: string;
};

// Task details > Infrastructure: the VMs a migration task moves, the host and
// Ceph cluster of each, and the capacity warnings of this task. Shown to users
// with `infrastructure:read`; editing needs `infrastructure:plan`.
export function TaskInfrastructureSection({ taskId, projectId }: Props) {
  const { t } = useTranslation();
  const { canPlanInfrastructure } = useProjectPermission(projectId);
  const canPlan = canPlanInfrastructure();

  const vmsQuery = useTaskVms(taskId);
  const hostsQuery = useProjectHosts(projectId);
  const clustersQuery = useProjectStorageClusters(projectId);
  const capacityQuery = useProjectCapacity(projectId);
  const modelsQuery = useProjectModels(projectId, canPlan);
  const replaceVms = useReplaceTaskVms();

  const savedRows = useMemo(
    () => rowsFromVms(vmsQuery.data ?? []),
    [vmsQuery.data],
  );
  // null: the user has not edited, the table shows the saved list.
  const [draft, setDraft] = useState<VmRow[] | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  // Hosts created from the editor, known before the host list has them.
  const [createdHostIds, setCreatedHostIds] = useState<Set<string>>(new Set());

  const rows = draft ?? savedRows;
  const isOpen = openChoice ?? savedRows.length > 0;
  const dirty =
    draft !== null && rowsSignature(draft) !== rowsSignature(savedRows);
  const isSaving = replaceVms.isPending;

  const clusters = clustersQuery.data ?? [];
  // A host that is no longer in the loaded list was deleted (in project
  // settings, or by someone else): the VM shows "Host removed" and is saved
  // without a host. Nothing is judged before the host list has loaded.
  const isHostRemoved = (row: VmRow) =>
    row.hostId !== null &&
    hostsQuery.isSuccess &&
    !createdHostIds.has(row.hostId) &&
    !(hostsQuery.data ?? []).some((host) => host.id === row.hostId);

  const edit = (update: (current: VmRow[]) => VmRow[]) => {
    setDraft((current) => update(current ?? savedRows));
  };

  const reset = () => {
    setDraft(null);
    setSubmitted(false);
  };

  const save = () => {
    if (!draft || !dirty || isSaving) return;
    setSubmitted(true);
    if (draft.some((row) => Object.keys(validateRow(row)).length > 0)) return;
    replaceVms.mutate(
      {
        projectId,
        taskId,
        vms: toVmInputs(
          draft.map((row) =>
            isHostRemoved(row) ? { ...row, hostId: null } : row,
          ),
        ),
      },
      {
        onSuccess: () => {
          reset();
          toast.success(t("tasks:infrastructure.saved"));
        },
      },
    );
  };

  const taskWarnings = (capacityQuery.data?.warnings ?? []).filter(
    (warning) => warning.taskId === taskId,
  );

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpenChoice}
      className="w-full"
      data-testid="task-infrastructure"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 justify-start gap-1 px-0 hover:bg-transparent"
        >
          {isOpen ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">
            {t("tasks:infrastructure.title")}
          </span>
          <Badge variant="outline" size="sm">
            {savedRows.length}
          </Badge>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3">
          <VmListEditor
            projectId={projectId}
            rows={rows}
            onChange={edit}
            hosts={hostsQuery.data}
            hostsLoaded={hostsQuery.isSuccess}
            clusters={clusters}
            models={modelsQuery.data ?? []}
            savedVms={vmsQuery.data ?? []}
            canEdit={canPlan}
            showAllErrors={submitted}
            onHostCreated={(host) =>
              setCreatedHostIds((current) => new Set(current).add(host.id))
            }
            actions={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!dirty || isSaving}
                  onClick={reset}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty || isSaving}
                  onClick={save}
                >
                  {isSaving
                    ? t("settings:projectInfrastructure.saving")
                    : t("settings:projectInfrastructure.save")}
                </Button>
              </div>
            }
          />

          {taskWarnings.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("tasks:infrastructure.warningsTitle")}
              </h3>
              <InfrastructureWarningList
                warnings={taskWarnings}
                hosts={capacityQuery.data?.hosts ?? []}
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
