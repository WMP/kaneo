import { ChevronDown, ChevronRight, Copy, Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InfraHost } from "@/fetchers/infrastructure/get-project-hosts";
import useReplaceTaskVms from "@/hooks/mutations/infrastructure/use-replace-task-vms";
import useProjectCapacity from "@/hooks/queries/infrastructure/use-project-capacity";
import useProjectHosts from "@/hooks/queries/infrastructure/use-project-hosts";
import useProjectModels from "@/hooks/queries/infrastructure/use-project-models";
import useProjectStorageClusters from "@/hooks/queries/infrastructure/use-project-storage-clusters";
import useTaskVms from "@/hooks/queries/infrastructure/use-task-vms";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { nextVmName } from "@/lib/infrastructure-format";
import { toast } from "@/lib/toast";
import { InfraSelect } from "../infra-select";
import { InfrastructureWarningList } from "../infrastructure-warning-list";
import { NewHostDialog } from "../new-host-dialog";
import {
  NUMBER_FIELDS,
  newRow,
  rowsFromVms,
  rowsSignature,
  toVmInputs,
  type VmNumberField,
  type VmRow,
  validateRow,
} from "./vm-rows";

const NONE = "__none__";
const NEW_HOST = "__new_host__";
const MAX_VMS = 200;

const NUMBER_COLUMN_KEYS: Record<VmNumberField, string> = {
  vcpu: "tasks:infrastructure.columns.vcpu",
  ramGb: "tasks:infrastructure.columns.ram",
  cephStorageGb: "tasks:infrastructure.columns.ceph",
  localStorageGb: "tasks:infrastructure.columns.local",
};

type Props = {
  taskId: string;
  projectId: string;
};

type HostSummary = Pick<InfraHost, "id" | "label" | "region" | "status">;

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
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  const [newHostRowKey, setNewHostRowKey] = useState<string | null>(null);
  // Hosts created from this section, kept until the host list has them.
  const [createdHosts, setCreatedHosts] = useState<HostSummary[]>([]);
  const rowCounter = useRef(0);

  const rows = draft ?? savedRows;
  const isOpen = openChoice ?? savedRows.length > 0;
  const dirty =
    draft !== null && rowsSignature(draft) !== rowsSignature(savedRows);
  const isSaving = replaceVms.isPending;

  const hosts = useMemo<HostSummary[]>(() => {
    const listed = hostsQuery.data ?? [];
    const known = new Set(listed.map((host) => host.id));
    return [...listed, ...createdHosts.filter((host) => !known.has(host.id))];
  }, [hostsQuery.data, createdHosts]);
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  );
  const clusters = clustersQuery.data ?? [];

  const statusText = (status: HostSummary["status"]) =>
    t(`common:infrastructureStatus.${status}`);

  const hostOptions = [
    { value: NONE, label: t("tasks:infrastructure.noHost") },
    ...hosts.map((host) => ({
      value: host.id,
      label: t("tasks:infrastructure.hostOption", {
        label: host.label,
        region: host.region,
        status: statusText(host.status),
      }),
    })),
    ...(canPlan
      ? [{ value: NEW_HOST, label: t("tasks:infrastructure.newHost") }]
      : []),
  ];

  const clusterOptionsFor = (row: VmRow) => {
    const region = row.hostId ? hostById.get(row.hostId)?.region : undefined;
    return [
      { value: NONE, label: t("tasks:infrastructure.noCluster") },
      ...clusters
        .filter((cluster) => !region || cluster.region === region)
        .map((cluster) => ({
          value: cluster.id,
          label: t("tasks:infrastructure.clusterOption", {
            name: cluster.name,
            region: cluster.region,
          }),
        })),
    ];
  };

  const edit = (update: (current: VmRow[]) => VmRow[]) => {
    setDraft((current) => update(current ?? savedRows));
  };
  const touch = (rowKey: string, field: string) =>
    setTouched((current) => new Set(current).add(`${rowKey}:${field}`));

  const updateRow = (rowKey: string, patch: Partial<VmRow>) =>
    edit((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    );

  // A cluster must be in the region of the host: changing the host clears a
  // cluster of another region.
  const setHost = (row: VmRow, hostId: string | null, hostRegion?: string) => {
    const region =
      hostRegion ?? (hostId ? hostById.get(hostId)?.region : undefined);
    const clusterRegion = clusters.find(
      (cluster) => cluster.id === row.storageClusterId,
    )?.region;
    const keepCluster = !region || !clusterRegion || region === clusterRegion;
    updateRow(row.key, {
      hostId,
      storageClusterId: keepCluster ? row.storageClusterId : null,
    });
  };

  const nextKey = () => {
    rowCounter.current += 1;
    return `new-${rowCounter.current}`;
  };

  const addRow = () => edit((current) => [...current, newRow(nextKey())]);

  const duplicateRow = (rowKey: string) =>
    edit((current) => {
      const index = current.findIndex((row) => row.key === rowKey);
      if (index < 0) return current;
      const source = current[index];
      const copy: VmRow = {
        ...source,
        key: nextKey(),
        id: undefined,
        name: nextVmName(
          source.name,
          current.map((row) => row.name),
        ),
      };
      return [
        ...current.slice(0, index + 1),
        copy,
        ...current.slice(index + 1),
      ];
    });

  const removeRow = (rowKey: string) =>
    edit((current) => current.filter((row) => row.key !== rowKey));

  const reset = () => {
    setDraft(null);
    setSubmitted(false);
    setTouched(new Set());
  };

  const save = () => {
    if (!draft || !dirty || isSaving) return;
    setSubmitted(true);
    if (draft.some((row) => Object.keys(validateRow(row)).length > 0)) return;
    replaceVms.mutate(
      { projectId, taskId, vms: toVmInputs(draft) },
      {
        onSuccess: () => {
          reset();
          toast.success(t("tasks:infrastructure.saved"));
        },
      },
    );
  };

  const showError = (row: VmRow, field: keyof ReturnType<typeof validateRow>) =>
    (submitted || touched.has(`${row.key}:${field}`)) &&
    Boolean(validateRow(row)[field]);

  const taskWarnings = (capacityQuery.data?.warnings ?? []).filter(
    (warning) => warning.taskId === taskId,
  );

  const newHostRow = rows.find((row) => row.key === newHostRowKey);

  return (
    <>
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
            {rows.length === 0 ? (
              <p className="px-3 text-sm text-muted-foreground">
                {t("tasks:infrastructure.empty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[56rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("tasks:infrastructure.columns.name")}
                      </TableHead>
                      {NUMBER_FIELDS.map((field) => (
                        <TableHead key={field} className="w-24">
                          {t(NUMBER_COLUMN_KEYS[field])}
                        </TableHead>
                      ))}
                      <TableHead>
                        {t("tasks:infrastructure.columns.host")}
                      </TableHead>
                      <TableHead>
                        {t("tasks:infrastructure.columns.cluster")}
                      </TableHead>
                      {canPlan && <TableHead className="w-20" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => {
                      const number = index + 1;
                      const host = row.hostId
                        ? hostById.get(row.hostId)
                        : undefined;
                      const cluster = clusters.find(
                        (item) => item.id === row.storageClusterId,
                      );
                      return (
                        <TableRow key={row.key}>
                          <TableCell className="align-top">
                            {canPlan ? (
                              <>
                                <Input
                                  size="sm"
                                  aria-label={t(
                                    "tasks:infrastructure.columns.name",
                                  )}
                                  value={row.name}
                                  maxLength={200}
                                  aria-invalid={
                                    showError(row, "name") || undefined
                                  }
                                  onChange={(event) => {
                                    touch(row.key, "name");
                                    updateRow(row.key, {
                                      name: event.target.value,
                                    });
                                  }}
                                />
                                {showError(row, "name") && (
                                  <p className="mt-1 text-xs text-destructive-foreground">
                                    {t(
                                      "tasks:infrastructure.validation.nameRequired",
                                    )}
                                  </p>
                                )}
                              </>
                            ) : (
                              <span className="font-medium">{row.name}</span>
                            )}
                          </TableCell>
                          {NUMBER_FIELDS.map((field) => (
                            <TableCell key={field} className="align-top">
                              {canPlan ? (
                                <>
                                  <Input
                                    size="sm"
                                    inputMode="numeric"
                                    aria-label={t(NUMBER_COLUMN_KEYS[field])}
                                    value={row[field]}
                                    aria-invalid={
                                      showError(row, field) || undefined
                                    }
                                    onChange={(event) => {
                                      touch(row.key, field);
                                      updateRow(row.key, {
                                        [field]: event.target.value,
                                      });
                                    }}
                                  />
                                  {showError(row, field) && (
                                    <p className="mt-1 text-xs text-destructive-foreground">
                                      {t(
                                        "tasks:infrastructure.validation.number",
                                      )}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <span className="tabular-nums">
                                  {row[field]}
                                </span>
                              )}
                            </TableCell>
                          ))}
                          <TableCell className="align-top">
                            {canPlan ? (
                              <InfraSelect
                                ariaLabel={t(
                                  "tasks:infrastructure.columns.host",
                                )}
                                placeholder={t("tasks:infrastructure.noHost")}
                                value={row.hostId ?? NONE}
                                options={hostOptions}
                                onChange={(value) => {
                                  if (value === NEW_HOST) {
                                    setNewHostRowKey(row.key);
                                  } else {
                                    setHost(row, value === NONE ? null : value);
                                  }
                                }}
                              />
                            ) : host ? (
                              t("tasks:infrastructure.hostOption", {
                                label: host.label,
                                region: host.region,
                                status: statusText(host.status),
                              })
                            ) : (
                              <span className="text-muted-foreground">
                                {t("tasks:infrastructure.noHost")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {canPlan ? (
                              <InfraSelect
                                ariaLabel={t(
                                  "tasks:infrastructure.columns.cluster",
                                )}
                                placeholder={t(
                                  "tasks:infrastructure.noCluster",
                                )}
                                value={row.storageClusterId ?? NONE}
                                options={clusterOptionsFor(row)}
                                onChange={(value) =>
                                  updateRow(row.key, {
                                    storageClusterId:
                                      value === NONE ? null : value,
                                  })
                                }
                              />
                            ) : cluster ? (
                              t("tasks:infrastructure.clusterOption", {
                                name: cluster.name,
                                region: cluster.region,
                              })
                            ) : (
                              <span className="text-muted-foreground">
                                {t("tasks:infrastructure.noCluster")}
                              </span>
                            )}
                          </TableCell>
                          {canPlan && (
                            <TableCell className="align-top">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(
                                    "tasks:infrastructure.duplicateRow",
                                    { number },
                                  )}
                                  disabled={rows.length >= MAX_VMS}
                                  onClick={() => duplicateRow(row.key)}
                                >
                                  <Copy aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(
                                    "tasks:infrastructure.removeRow",
                                    { number },
                                  )}
                                  onClick={() => removeRow(row.key)}
                                >
                                  <X aria-hidden="true" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {canPlan && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  disabled={rows.length >= MAX_VMS}
                  onClick={addRow}
                >
                  <Plus className="size-4" />
                  {t("tasks:infrastructure.addVm")}
                </Button>
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
              </div>
            )}

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

      {canPlan && (
        <NewHostDialog
          projectId={projectId}
          models={modelsQuery.data ?? []}
          open={newHostRowKey !== null}
          onOpenChange={(open) => {
            if (!open) setNewHostRowKey(null);
          }}
          onCreated={(host) => {
            setCreatedHosts((current) => [...current, host]);
            if (newHostRow) setHost(newHostRow, host.id, host.region);
          }}
        />
      )}
    </>
  );
}
