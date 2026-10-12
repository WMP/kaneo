import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfrastructureStatusBadge } from "@/components/infrastructure/status-badge";
import { UsageBar } from "@/components/infrastructure/usage-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateStorageCapacity,
  useCreateStorageCluster,
  useDeleteStorageCapacity,
  useDeleteStorageCluster,
  useUpdateStorageCapacity,
  useUpdateStorageCluster,
} from "@/hooks/mutations/infrastructure/datacenter/use-datacenter-mutations";
import { ClusterDialog } from "./cluster-dialog";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { EntryDialog } from "./entry-dialog";
import { formatDay, formatGb, formatNumber } from "./format";
import { StatusDialog } from "./status-dialog";
import type {
  ClusterCapacity,
  StorageCapacityEntry,
  StorageCluster,
} from "./types";

type DialogState =
  | { type: "cluster"; cluster?: StorageCluster }
  | { type: "entry"; cluster: StorageCluster }
  | { type: "status"; cluster: StorageCluster; entry: StorageCapacityEntry }
  | { type: "deleteCluster"; cluster: StorageCluster }
  | {
      type: "deleteEntry";
      cluster: StorageCluster;
      entry: StorageCapacityEntry;
    };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SuggestionText({ result }: { result: ClusterCapacity["result"] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const suggestion = result.suggestion;
  if (!suggestion) return null;
  const date = suggestion.orderByDate
    ? formatDay(suggestion.orderByDate, locale)
    : null;

  if (suggestion.kind === "service") {
    const params = { buy: formatGb(suggestion.buyGb ?? 0, locale), date };
    return (
      <>
        {date
          ? t("workspace:datacenter.storage.suggestionService", params)
          : t("workspace:datacenter.storage.suggestionServiceNoDate", params)}
      </>
    );
  }
  if (suggestion.nodes == null || suggestion.nodeCapacityGb == null) {
    const params = {
      shortfall: formatGb(suggestion.shortfallGb, locale),
      date,
    };
    return (
      <>
        {date
          ? t("workspace:datacenter.storage.suggestionNodesUnknown", params)
          : t(
              "workspace:datacenter.storage.suggestionNodesUnknownNoDate",
              params,
            )}
      </>
    );
  }
  const node = [
    suggestion.modelName,
    formatGb(suggestion.nodeCapacityGb, locale),
  ]
    .filter(Boolean)
    .join(" ");
  const params = { nodes: formatNumber(suggestion.nodes, locale), node, date };
  return (
    <>
      {date
        ? t("workspace:datacenter.storage.suggestionNodes", params)
        : t("workspace:datacenter.storage.suggestionNodesNoDate", params)}
    </>
  );
}

function ClusterCard({
  cluster,
  result,
  canManage,
  onDialog,
}: {
  cluster: StorageCluster;
  result: ClusterCapacity["result"] | undefined;
  canManage: boolean;
  onDialog: (dialog: DialogState) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const dash = "–";
  const last = result?.steps.at(-1);
  const usable = last?.usableGb;
  const used = last?.usedCephGb ?? cluster.totals.usedCephGb;
  const selfManaged = cluster.kind === "self_managed";

  return (
    <article
      className="space-y-4 rounded-md border bg-card p-4"
      aria-label={cluster.name}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-base font-medium">{cluster.name}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" size="sm">
              {cluster.region}
            </Badge>
            <Badge variant="outline" size="sm">
              {t(`workspace:datacenter.kind.${cluster.kind}`)}
            </Badge>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onDialog({ type: "entry", cluster })}
            >
              <Plus />
              {t("workspace:datacenter.storage.addEntry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onDialog({ type: "cluster", cluster })}
            >
              {t("workspace:datacenter.storage.editCluster")}
            </Button>
            <Button
              type="button"
              variant="destructive-outline"
              size="xs"
              onClick={() => onDialog({ type: "deleteCluster", cluster })}
            >
              {t("common:actions.delete")}
            </Button>
          </div>
        )}
      </header>

      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {selfManaged && (
          <Fact
            label={t("workspace:datacenter.storage.erasureCoding")}
            value={`${cluster.ecDataChunks}+${cluster.ecCodingChunks}`}
          />
        )}
        <Fact
          label={t("workspace:datacenter.fields.fillThreshold")}
          value={`${cluster.fillThresholdPercent}%`}
        />
        <Fact
          label={t("workspace:datacenter.storage.installed")}
          value={formatGb(cluster.totals.rawCapacityGb, locale)}
        />
        <Fact
          label={t("workspace:datacenter.storage.usable")}
          value={usable == null ? dash : formatGb(usable, locale)}
        />
        <Fact
          label={t("workspace:datacenter.storage.used")}
          value={formatGb(used, locale)}
        />
        <Fact
          label={t("workspace:datacenter.storage.firstOver80")}
          value={
            result?.firstOver80Date
              ? formatDay(result.firstOver80Date, locale)
              : dash
          }
        />
        <Fact
          label={t("workspace:datacenter.storage.firstOver100")}
          value={
            result?.firstOver100Date
              ? formatDay(result.firstOver100Date, locale)
              : dash
          }
        />
      </dl>

      <UsageBar
        percent={last?.percent ?? null}
        label={t("workspace:datacenter.storage.usage", {
          cluster: cluster.name,
        })}
        className="max-w-md"
      />

      {result && result.shortfallGb > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/25 bg-destructive/4 p-3 text-sm">
          <p className="font-medium text-destructive-foreground">
            {t("workspace:datacenter.storage.shortfall", {
              shortfall: formatGb(result.shortfallGb, locale),
            })}
          </p>
          <p>
            <SuggestionText result={result} />
          </p>
        </div>
      )}

      {cluster.capacity.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("workspace:datacenter.storage.noEntries")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("workspace:datacenter.fields.label")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.model")}</TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.fields.capacity")}
                </TableHead>
                <TableHead>{t("workspace:datacenter.fields.status")}</TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.availableFrom")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.hostname")}
                </TableHead>
                {canManage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cluster.capacity.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.label}</TableCell>
                  <TableCell>{entry.modelName ?? dash}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatGb(entry.capacityGb, locale)}
                  </TableCell>
                  <TableCell>
                    <InfrastructureStatusBadge status={entry.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entry.availableFrom
                      ? formatDay(entry.availableFrom, locale)
                      : dash}
                  </TableCell>
                  <TableCell>{entry.hostname ?? dash}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() =>
                            onDialog({ type: "status", cluster, entry })
                          }
                        >
                          {t("workspace:datacenter.actions.changeStatus")}
                        </Button>
                        {entry.status === "planned" && (
                          <Button
                            type="button"
                            variant="destructive-outline"
                            size="xs"
                            onClick={() =>
                              onDialog({ type: "deleteEntry", cluster, entry })
                            }
                          >
                            {t("common:actions.delete")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </article>
  );
}

export function StorageTab({
  workspaceId,
  clusters,
  results,
  canManage,
}: {
  workspaceId: string;
  clusters: StorageCluster[];
  results: ClusterCapacity[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const createCluster = useCreateStorageCluster();
  const updateCluster = useUpdateStorageCluster();
  const deleteCluster = useDeleteStorageCluster();
  const createEntry = useCreateStorageCapacity();
  const updateEntry = useUpdateStorageCapacity();
  const deleteEntry = useDeleteStorageCapacity();

  const resultByCluster = useMemo(
    () => new Map(results.map((entry) => [entry.cluster.id, entry.result])),
    [results],
  );
  const close = () => setDialog(null);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialog({ type: "cluster" })}
          >
            <Plus />
            {t("workspace:datacenter.storage.addCluster")}
          </Button>
        </div>
      )}

      {clusters.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("workspace:datacenter.storage.empty")}
        </p>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              result={resultByCluster.get(cluster.id)}
              canManage={canManage}
              onDialog={setDialog}
            />
          ))}
        </div>
      )}

      {dialog?.type === "cluster" && (
        <ClusterDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          cluster={dialog.cluster}
          onSubmit={(data) =>
            dialog.cluster
              ? updateCluster.mutateAsync({
                  workspaceId,
                  clusterId: dialog.cluster.id,
                  data,
                })
              : createCluster.mutateAsync({ workspaceId, data })
          }
        />
      )}
      {dialog?.type === "entry" && (
        <EntryDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          clusterName={dialog.cluster.name}
          onSubmit={(data) =>
            createEntry.mutateAsync({
              workspaceId,
              clusterId: dialog.cluster.id,
              data,
            })
          }
        />
      )}
      {dialog?.type === "status" && (
        <StatusDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          subject={dialog.entry.label}
          initial={{
            status: dialog.entry.status,
            availableFrom: dialog.entry.availableFrom,
            hostname: dialog.entry.hostname,
          }}
          onSubmit={(change) =>
            updateEntry.mutateAsync({
              workspaceId,
              clusterId: dialog.cluster.id,
              entryId: dialog.entry.id,
              data: change,
            })
          }
        />
      )}
      {dialog?.type === "deleteCluster" && (
        <ConfirmDeleteDialog
          title={t("workspace:datacenter.storage.deleteClusterTitle", {
            name: dialog.cluster.name,
          })}
          description={t(
            "workspace:datacenter.storage.deleteClusterDescription",
          )}
          onClose={close}
          onConfirm={() =>
            deleteCluster.mutateAsync({
              workspaceId,
              clusterId: dialog.cluster.id,
            })
          }
        />
      )}
      {dialog?.type === "deleteEntry" && (
        <ConfirmDeleteDialog
          title={t("workspace:datacenter.storage.deleteEntryTitle", {
            name: dialog.entry.label,
          })}
          description={t("workspace:datacenter.storage.deleteEntryDescription")}
          onClose={close}
          onConfirm={() =>
            deleteEntry.mutateAsync({
              workspaceId,
              clusterId: dialog.cluster.id,
              entryId: dialog.entry.id,
            })
          }
        />
      )}
    </div>
  );
}
