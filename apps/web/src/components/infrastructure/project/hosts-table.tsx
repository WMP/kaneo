import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectCapacity } from "@/fetchers/infrastructure/get-project-capacity";
import type { InfraHost } from "@/fetchers/infrastructure/get-project-hosts";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import useDeleteProjectHost from "@/hooks/mutations/infrastructure/use-delete-project-host";
import useUpdateProjectHost from "@/hooks/mutations/infrastructure/use-update-project-host";
import useProjectRegions from "@/hooks/queries/infrastructure/use-project-regions";
import { cn } from "@/lib/cn";
import { formatInfraDate, isBeforeDay } from "@/lib/infrastructure-format";
import { InfraSelect } from "../infra-select";
import { NewHostDialog } from "../new-host-dialog";
import { InfrastructureStatusBadge } from "../status-badge";
import { UsageBar } from "../usage-bar";

type Props = {
  projectId: string;
  hosts: InfraHost[];
  models: InfraModel[];
  capacity: ProjectCapacity | undefined;
  canPlan: boolean;
  canManage: boolean;
};

function RenameHostDialog({
  projectId,
  host,
  onClose,
}: {
  projectId: string;
  host: InfraHost;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const updateHost = useUpdateProjectHost();
  const [label, setLabel] = useState(host.label);
  const [zone, setZone] = useState<string | null>(host.zone);
  const trimmed = label.trim();
  const regionsQuery = useProjectRegions(projectId);
  const regionZones =
    regionsQuery.data?.find((item) => item.code === host.region)?.zones ?? [];
  // The zone can change only while the host is planned (the API answers 409
  // otherwise), and only to a zone of its region.
  const zoneEditable = host.status === "planned" && regionZones.length > 0;
  const zoneChanged = zoneEditable && zone !== null && zone !== host.zone;
  const labelChanged = trimmed !== host.label;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || updateHost.isPending) return;
    if (!labelChanged && !zoneChanged) {
      onClose();
      return;
    }
    updateHost.mutate(
      {
        projectId,
        hostId: host.id,
        ...(labelChanged ? { label: trimmed } : {}),
        ...(zoneChanged ? { zone } : {}),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !updateHost.isPending) onClose();
      }}
    >
      <DialogContent>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t("settings:projectInfrastructure.hosts.rename")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="host-label">
                {t("settings:projectInfrastructure.hosts.label")}
              </Label>
              <Input
                id="host-label"
                value={label}
                maxLength={200}
                onChange={(event) => setLabel(event.target.value)}
                autoFocus
              />
            </div>
            {zoneEditable ? (
              <div className="grid gap-2">
                <Label>{t("settings:projectInfrastructure.hosts.zone")}</Label>
                <InfraSelect
                  ariaLabel={t("settings:projectInfrastructure.hosts.zone")}
                  placeholder={t(
                    "settings:projectInfrastructure.hosts.zonePlaceholder",
                  )}
                  value={zone}
                  options={regionZones.map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  onChange={setZone}
                />
              </div>
            ) : (
              host.zone && (
                <div className="grid gap-1">
                  <span className="font-medium text-base/4.5 sm:text-sm/4">
                    {t("settings:projectInfrastructure.hosts.zone")}
                  </span>
                  <span className="text-sm">{host.zone}</span>
                </div>
              )
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={updateHost.isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || updateHost.isPending}>
              {updateHost.isPending
                ? t("settings:projectInfrastructure.saving")
                : t("settings:projectInfrastructure.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HostsTable({
  projectId,
  hosts,
  models,
  capacity,
  canPlan,
  canManage,
}: Props) {
  const { t } = useTranslation();
  const deleteHost = useDeleteProjectHost();
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<InfraHost | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InfraHost | null>(null);

  const resultByHost = new Map(
    (capacity?.hosts ?? []).map((entry) => [entry.host.id, entry.result]),
  );
  const showActions = canPlan || canManage;

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteHost.mutate(
      { projectId, hostId: pendingDelete.id },
      { onSettled: () => setPendingDelete(null) },
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="infra-hosts-title">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="infra-hosts-title" className="text-base font-semibold">
            {t("settings:projectInfrastructure.hosts.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings:projectInfrastructure.hosts.description")}
          </p>
        </div>
        {canPlan && (
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" />
            {t("settings:projectInfrastructure.hosts.add")}
          </Button>
        )}
      </div>

      {hosts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:projectInfrastructure.hosts.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.label")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.model")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.region")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.zone")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.status")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.needDate")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.orderBy")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.ram")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.vms")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.hosts.columns.localDisk")}
                </TableHead>
                {showActions && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {hosts.map((host) => {
                const result = resultByHost.get(host.id);
                const orderByLate =
                  host.status === "planned" &&
                  isBeforeDay(result?.orderByDate ?? null, capacity?.today);
                return (
                  <TableRow key={host.id}>
                    <TableCell className="font-medium">{host.label}</TableCell>
                    <TableCell>
                      {host.model.name} · {host.model.ramGb} GB
                    </TableCell>
                    <TableCell>{host.region}</TableCell>
                    <TableCell>{host.zone ?? "–"}</TableCell>
                    <TableCell>
                      <InfrastructureStatusBadge status={host.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {result?.needDate
                        ? formatInfraDate(result.needDate)
                        : "–"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap",
                        orderByLate && "text-destructive-foreground",
                      )}
                      data-late={orderByLate || undefined}
                      title={
                        orderByLate
                          ? t("settings:projectInfrastructure.hosts.orderLate")
                          : undefined
                      }
                    >
                      {result?.orderByDate
                        ? formatInfraDate(result.orderByDate)
                        : "–"}
                    </TableCell>
                    <TableCell>
                      <UsageBar
                        percent={result?.peakRamPercent ?? null}
                        label={t(
                          "settings:projectInfrastructure.hosts.ramUsage",
                          { host: host.label },
                        )}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {host.totals.vmCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {host.totals.localStorageGb} / {host.model.storageGb}
                    </TableCell>
                    {showActions && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canPlan && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t(
                                "settings:projectInfrastructure.hosts.renameAction",
                                { label: host.label },
                              )}
                              onClick={() => setRenaming(host)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                          )}
                          {canManage && host.status === "planned" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t(
                                "settings:projectInfrastructure.hosts.deleteAction",
                                { label: host.label },
                              )}
                              onClick={() => setPendingDelete(host)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          )}
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
        <NewHostDialog
          projectId={projectId}
          models={models}
          allowQuantity
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
      {canPlan && renaming && (
        <RenameHostDialog
          key={renaming.id}
          projectId={projectId}
          host={renaming}
          onClose={() => setRenaming(null)}
        />
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteHost.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectInfrastructure.hosts.deleteTitle", {
                label: pendingDelete?.label ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectInfrastructure.hosts.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" />}
              disabled={deleteHost.isPending}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteHost.isPending}
            >
              {t("common:actions.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
