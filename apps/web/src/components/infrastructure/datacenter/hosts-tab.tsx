import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfrastructureStatusBadge } from "@/components/infrastructure/status-badge";
import { UsageBar } from "@/components/infrastructure/usage-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSetHostStatus } from "@/hooks/mutations/infrastructure/datacenter/use-datacenter-mutations";
import { DcSelect } from "./dc-select";
import { formatDay, formatNumber } from "./format";
import { StatusDialog } from "./status-dialog";
import type { DatacenterHost, WorkspaceCapacity } from "./types";
import { namesOf, WarningList } from "./warnings";

const ALL = "all";

export function HostsTab({
  workspaceId,
  hosts,
  capacity,
  canManage,
}: {
  workspaceId: string;
  hosts: DatacenterHost[];
  capacity: WorkspaceCapacity | undefined;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const hostStatus = useSetHostStatus();
  const [project, setProject] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [editing, setEditing] = useState<DatacenterHost | null>(null);

  const resultByHost = useMemo(
    () =>
      new Map(capacity?.hosts.map((entry) => [entry.host.id, entry.result])),
    [capacity],
  );
  const names = useMemo(
    () =>
      capacity
        ? namesOf(capacity)
        : {
            hosts: new Map<string, string>(),
            clusters: new Map<string, string>(),
          },
    [capacity],
  );

  const projects = useMemo(
    () => [...new Set(hosts.map((host) => host.projectName))].sort(),
    [hosts],
  );
  const regions = useMemo(
    () => [...new Set(hosts.map((host) => host.region))].sort(),
    [hosts],
  );

  const visible = hosts.filter(
    (host) =>
      (project === ALL || host.projectName === project) &&
      (region === ALL || host.region === region) &&
      (statusFilter === ALL || host.status === statusFilter),
  );
  const visibleIds = new Set(visible.map((host) => host.id));
  const warnings = (capacity?.warnings ?? []).filter(
    (warning) => warning.hostId && visibleIds.has(warning.hostId),
  );
  const dash = "–";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DcSelect
          ariaLabel={t("workspace:datacenter.fields.project")}
          value={project}
          onChange={setProject}
          options={[
            { value: ALL, label: t("workspace:datacenter.hosts.allProjects") },
            ...projects.map((value) => ({ value, label: value })),
          ]}
        />
        <DcSelect
          ariaLabel={t("workspace:datacenter.fields.region")}
          value={region}
          onChange={setRegion}
          options={[
            { value: ALL, label: t("workspace:datacenter.hosts.allRegions") },
            ...regions.map((value) => ({ value, label: value })),
          ]}
        />
        <DcSelect
          ariaLabel={t("workspace:datacenter.fields.status")}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: ALL, label: t("workspace:datacenter.hosts.allStatuses") },
            ...(["planned", "ordered", "installed"] as const).map((value) => ({
              value,
              label: t(`common:infrastructureStatus.${value}`),
            })),
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("workspace:datacenter.hosts.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("workspace:datacenter.fields.project")}
                </TableHead>
                <TableHead>{t("workspace:datacenter.hosts.host")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.model")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.region")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.status")}</TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.availableFrom")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.hostname")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.needDate")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.orderPlan.orderBy")}
                </TableHead>
                <TableHead>{t("workspace:datacenter.hosts.ramPeak")}</TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.hosts.vms")}
                </TableHead>
                {canManage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((host) => {
                const result = resultByHost.get(host.id);
                return (
                  <TableRow key={host.id}>
                    <TableCell>{host.projectName}</TableCell>
                    <TableCell className="font-medium">{host.label}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {host.model.name} ·{" "}
                      {formatNumber(host.model.ramGb, locale)} GB
                    </TableCell>
                    <TableCell>{host.region}</TableCell>
                    <TableCell>
                      <InfrastructureStatusBadge status={host.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {host.availableFrom
                        ? formatDay(host.availableFrom, locale)
                        : dash}
                    </TableCell>
                    <TableCell>{host.hostname ?? dash}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {result?.needDate
                        ? formatDay(result.needDate, locale)
                        : dash}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {result?.orderByDate
                        ? formatDay(result.orderByDate, locale)
                        : dash}
                    </TableCell>
                    <TableCell>
                      <UsageBar
                        percent={result?.peakRamPercent ?? null}
                        label={t("workspace:datacenter.hosts.ramUse", {
                          host: host.label,
                        })}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(host.totals.vmCount, locale)}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => setEditing(host)}
                        >
                          {t("workspace:datacenter.actions.changeStatus")}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {warnings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            {t("workspace:datacenter.hosts.warnings")}
          </h2>
          <WarningList warnings={warnings} names={names} />
        </section>
      )}

      {editing && (
        <StatusDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          subject={editing.label}
          initial={{
            status: editing.status,
            availableFrom: editing.availableFrom,
            hostname: editing.hostname,
          }}
          onSubmit={(change) =>
            hostStatus.mutateAsync({
              workspaceId,
              hostId: editing.id,
              ...change,
            })
          }
        />
      )}
    </div>
  );
}
