import { Copy, Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InfraHost } from "@/fetchers/infrastructure/get-project-hosts";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import type { InfraStorageClusterSummary } from "@/fetchers/infrastructure/get-project-storage-clusters";
import type { InfraVm } from "@/fetchers/infrastructure/get-task-vms";
import { nextVmName } from "@/lib/infrastructure-format";
import {
  computeHostUsage,
  freeCapacityForRow,
  type HostUsage,
  isOverCapacity,
  usagePercent,
} from "@/lib/infrastructure-host-usage";
import { InfraSelect } from "../infra-select";
import { NewHostDialog } from "../new-host-dialog";
import { UsageBar } from "../usage-bar";
import {
  NUMBER_FIELDS,
  newRow,
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

type HostSummary = Pick<
  InfraHost,
  "id" | "label" | "region" | "zone" | "status"
>;

// "PAR" for a host without a zone, "PAR / PAR2" for one in a zone.
const regionText = (host: Pick<HostSummary, "region" | "zone">) =>
  host.zone ? `${host.region} / ${host.zone}` : host.region;

// Row keys must stay unique while rows move between editors or survive a
// remount of the editor, so the counter lives outside the component.
let rowCounter = 0;
const nextRowKey = () => {
  rowCounter += 1;
  return `new-${rowCounter}`;
};

type Props = {
  projectId: string;
  rows: VmRow[];
  // Receives a function from the current rows to the next rows.
  onChange: (update: (current: VmRow[]) => VmRow[]) => void;
  // The project's hosts, undefined until loaded.
  hosts: InfraHost[] | undefined;
  hostsLoaded: boolean;
  clusters: InfraStorageClusterSummary[];
  models: InfraModel[];
  // Saved VMs of the task: the hosts' totals already include them, so the
  // utilization math swaps them for the rows. Empty for a task not yet created.
  savedVms: InfraVm[];
  canEdit: boolean;
  // Shows the validation message of every field, not only the touched ones.
  showAllErrors?: boolean;
  // Rendered at the end of the row with the add button (Save, Cancel, ...).
  actions?: ReactNode;
  // A host was created from the "New host..." dialog and assigned to a row.
  onHostCreated?: (host: InfraHost) => void;
};

// The VM cards of a task: name, host (with free capacity), Ceph cluster, sizes,
// the usage of the host with these rows, and the field validation messages.
// The rows live in the parent; it decides when they are saved.
export function VmListEditor({
  projectId,
  rows,
  onChange,
  hosts: loadedHosts,
  hostsLoaded,
  clusters,
  models,
  savedVms,
  canEdit,
  showAllErrors = false,
  actions,
  onHostCreated,
}: Props) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [newHostRowKey, setNewHostRowKey] = useState<string | null>(null);
  // Hosts created from this editor, kept until the host list has them.
  const [createdHosts, setCreatedHosts] = useState<HostSummary[]>([]);

  const hosts = useMemo<HostSummary[]>(() => {
    const listed = loadedHosts ?? [];
    const known = new Set(listed.map((host) => host.id));
    return [...listed, ...createdHosts.filter((host) => !known.has(host.id))];
  }, [loadedHosts, createdHosts]);
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  );
  // A host that is no longer in the loaded list was deleted (in project
  // settings, or by someone else): the VM shows "Host removed" and is saved
  // without a host. Nothing is judged before the host list has loaded.
  const isHostRemoved = (row: VmRow) =>
    row.hostId !== null && hostsLoaded && !hostById.has(row.hostId);

  const statusText = (status: HostSummary["status"]) =>
    t(`common:infrastructureStatus.${status}`);

  // Peak use of every project host with this editor's rows, saved or not.
  const usageByHost = useMemo(
    () => computeHostUsage(loadedHosts ?? [], savedVms, rows),
    [loadedHosts, savedVms, rows],
  );

  const hostOptionLabel = (row: VmRow, listed: HostSummary) => {
    const base = t("tasks:infrastructure.hostOption", {
      label: listed.label,
      region: regionText(listed),
      status: statusText(listed.status),
    });
    // Hosts created in this editor have no capacity figures yet.
    const detailed = loadedHosts?.find((item) => item.id === listed.id);
    if (!detailed) return base;
    const free = freeCapacityForRow(detailed, savedVms, rows, row.key);
    const need = rowNeed(row);
    const noRoom = need.ram > free.ram || need.vcpu > free.vcpu;
    return [
      base,
      t("tasks:infrastructure.hostFree", {
        ram: Math.max(0, free.ram),
        vcpu: Math.max(0, free.vcpu),
      }),
      ...(noRoom ? [t("tasks:infrastructure.hostNoRoom")] : []),
    ].join(" — ");
  };

  const hostOptionsFor = (row: VmRow) => [
    { value: NONE, label: t("tasks:infrastructure.noHost") },
    ...(row.hostId && isHostRemoved(row)
      ? [{ value: row.hostId, label: t("tasks:infrastructure.hostRemoved") }]
      : []),
    ...hosts.map((listed) => ({
      value: listed.id,
      label: hostOptionLabel(row, listed),
    })),
    ...(canEdit
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

  const touch = (rowKey: string, field: string) =>
    setTouched((current) => new Set(current).add(`${rowKey}:${field}`));

  const updateRow = (rowKey: string, patch: Partial<VmRow>) =>
    onChange((current) =>
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

  const addRow = () =>
    onChange((current) => [...current, newRow(nextRowKey())]);

  const duplicateRow = (rowKey: string) =>
    onChange((current) => {
      const index = current.findIndex((row) => row.key === rowKey);
      if (index < 0) return current;
      const source = current[index];
      const copy: VmRow = {
        ...source,
        key: nextRowKey(),
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
    onChange((current) => current.filter((row) => row.key !== rowKey));

  const showError = (row: VmRow, field: keyof ReturnType<typeof validateRow>) =>
    (showAllErrors || touched.has(`${row.key}:${field}`)) &&
    Boolean(validateRow(row)[field]);

  const newHostRow = rows.find((row) => row.key === newHostRowKey);

  return (
    <>
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">
            {t("tasks:infrastructure.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, index) => {
              const number = index + 1;
              const host = row.hostId ? hostById.get(row.hostId) : undefined;
              const cluster = clusters.find(
                (item) => item.id === row.storageClusterId,
              );
              return (
                // One VM per block: identity and placement on the first
                // line, sizes on the second, so it fits the task panel.
                <li key={row.key} className="rounded-md border p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_auto]">
                    <VmField label={t("tasks:infrastructure.columns.name")}>
                      {canEdit ? (
                        <>
                          <Input
                            size="sm"
                            aria-label={t("tasks:infrastructure.columns.name")}
                            value={row.name}
                            maxLength={200}
                            aria-invalid={showError(row, "name") || undefined}
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
                    </VmField>
                    <VmField label={t("tasks:infrastructure.columns.host")}>
                      {canEdit ? (
                        <InfraSelect
                          ariaLabel={t("tasks:infrastructure.columns.host")}
                          placeholder={t("tasks:infrastructure.noHost")}
                          value={row.hostId ?? NONE}
                          options={hostOptionsFor(row)}
                          className={
                            isHostRemoved(row)
                              ? "text-warning-foreground"
                              : undefined
                          }
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
                          region: regionText(host),
                          status: statusText(host.status),
                        })
                      ) : isHostRemoved(row) ? (
                        <span className="text-warning-foreground">
                          {t("tasks:infrastructure.hostRemoved")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("tasks:infrastructure.noHost")}
                        </span>
                      )}
                    </VmField>
                    <VmField label={t("tasks:infrastructure.columns.cluster")}>
                      {canEdit ? (
                        <InfraSelect
                          ariaLabel={t("tasks:infrastructure.columns.cluster")}
                          placeholder={t("tasks:infrastructure.noCluster")}
                          value={row.storageClusterId ?? NONE}
                          options={clusterOptionsFor(row)}
                          onChange={(value) =>
                            updateRow(row.key, {
                              storageClusterId: value === NONE ? null : value,
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
                    </VmField>
                    {canEdit && (
                      <div className="flex items-end justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("tasks:infrastructure.duplicateRow", {
                            number,
                          })}
                          disabled={rows.length >= MAX_VMS}
                          onClick={() => duplicateRow(row.key)}
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("tasks:infrastructure.removeRow", {
                            number,
                          })}
                          onClick={() => removeRow(row.key)}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {NUMBER_FIELDS.map((field) => (
                      <VmField key={field} label={t(NUMBER_COLUMN_KEYS[field])}>
                        {canEdit ? (
                          <>
                            <Input
                              size="sm"
                              inputMode="numeric"
                              aria-label={t(NUMBER_COLUMN_KEYS[field])}
                              value={row[field]}
                              aria-invalid={showError(row, field) || undefined}
                              onChange={(event) => {
                                touch(row.key, field);
                                updateRow(row.key, {
                                  [field]: event.target.value,
                                });
                              }}
                            />
                            {showError(row, field) && (
                              <p className="mt-1 text-xs text-destructive-foreground">
                                {t("tasks:infrastructure.validation.number")}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="tabular-nums">{row[field]}</span>
                        )}
                      </VmField>
                    ))}
                  </div>
                  {host && usageByHost.get(host.id) && (
                    <HostUsageLine
                      hostLabel={host.label}
                      usage={usageByHost.get(host.id) as HostUsage}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {rows.some((row) => row.hostId && usageByHost.has(row.hostId)) && (
          <p className="px-1 text-muted-foreground text-xs">
            {t("tasks:infrastructure.usageHelp")}
          </p>
        )}

        {canEdit && (
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
            {actions}
          </div>
        )}
      </div>

      {canEdit && (
        <NewHostDialog
          projectId={projectId}
          models={models}
          open={newHostRowKey !== null}
          onOpenChange={(open) => {
            if (!open) setNewHostRowKey(null);
          }}
          onCreated={(host) => {
            setCreatedHosts((current) => [...current, host]);
            onHostCreated?.(host);
            if (newHostRow) setHost(newHostRow, host.id, host.region);
          }}
        />
      )}
    </>
  );
}

function rowNeed(row: VmRow) {
  const parse = (value: string) =>
    /^\d+$/.test(value.trim()) ? Number(value) : 0;
  return { ram: parse(row.ramGb), vcpu: parse(row.vcpu) };
}

// Peak use of the host of a VM, with these rows included.
function HostUsageLine({
  hostLabel,
  usage,
}: {
  hostLabel: string;
  usage: HostUsage;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <UsageBar
          className="w-40 min-w-0 shrink-0"
          percent={usagePercent(usage.ram)}
          label={t("tasks:infrastructure.usageRamLabel", { host: hostLabel })}
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("tasks:infrastructure.usageText", {
            ramUsed: usage.ram.used,
            ramCapacity: usage.ram.capacity,
            vcpuUsed: usage.vcpu.used,
            vcpuCapacity: usage.vcpu.capacity,
            localUsed: usage.localStorage.used,
            localCapacity: usage.localStorage.capacity,
          })}
        </span>
      </div>
      {isOverCapacity(usage) && (
        <p role="status" className="text-destructive-foreground text-xs">
          {t("tasks:infrastructure.usageOver")}
        </p>
      )}
    </div>
  );
}

// A labelled cell of a VM block; the inputs keep their own accessible name.
function VmField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}
