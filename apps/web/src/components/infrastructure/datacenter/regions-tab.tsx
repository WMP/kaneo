import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCreateRegion,
  useDeleteRegion,
  useUpdateRegion,
} from "@/hooks/mutations/infrastructure/datacenter/use-datacenter-mutations";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { RegionDialog } from "./region-dialog";
import type { CatalogRegion } from "./types";

type DialogState =
  | { type: "region"; region?: CatalogRegion }
  | { type: "delete"; region: CatalogRegion };

function isUsed(region: CatalogRegion) {
  const { models, hosts, clusters } = region.usage;
  return models + hosts + clusters > 0;
}

// The region catalog of the workspace: the only codes models and clusters may
// use. Everyone with datacenter read sees it; `datacenter:manage` edits it.
export function RegionsTab({
  workspaceId,
  regions,
  canManage,
}: {
  workspaceId: string;
  regions: CatalogRegion[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const createRegion = useCreateRegion();
  const updateRegion = useUpdateRegion();
  const deleteRegion = useDeleteRegion();
  const close = () => setDialog(null);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialog({ type: "region" })}
          >
            <Plus />
            {t("workspace:datacenter.regions.add")}
          </Button>
        </div>
      )}

      {regions.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("workspace:datacenter.regions.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("workspace:datacenter.regions.code")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.name")}</TableHead>
                <TableHead>
                  {t("workspace:datacenter.regions.usedBy")}
                </TableHead>
                {canManage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {regions.map((region) => {
                const used = isUsed(region);
                return (
                  <TableRow key={region.id}>
                    <TableCell className="font-medium">{region.code}</TableCell>
                    <TableCell>{region.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                        <span>
                          {t("workspace:datacenter.regions.usage.models")}:{" "}
                          {region.usage.models}
                        </span>
                        <span>
                          {t("workspace:datacenter.regions.usage.hosts")}:{" "}
                          {region.usage.hosts}
                        </span>
                        <span>
                          {t("workspace:datacenter.regions.usage.clusters")}:{" "}
                          {region.usage.clusters}
                        </span>
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t(
                              "workspace:datacenter.regions.editAction",
                              { code: region.code },
                            )}
                            onClick={() =>
                              setDialog({ type: "region", region })
                            }
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          {used ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  // A disabled button gets no pointer events,
                                  // so the span carries the tooltip.
                                  <span className="inline-flex" />
                                }
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled
                                  aria-label={t(
                                    "workspace:datacenter.regions.deleteAction",
                                    { code: region.code },
                                  )}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipPopup>
                                {t("workspace:datacenter.errors.regionInUse")}
                              </TooltipPopup>
                            </Tooltip>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t(
                                "workspace:datacenter.regions.deleteAction",
                                { code: region.code },
                              )}
                              onClick={() =>
                                setDialog({ type: "delete", region })
                              }
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

      {dialog?.type === "region" && (
        <RegionDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          region={dialog.region}
          onSubmit={(data) =>
            dialog.region
              ? updateRegion.mutateAsync({
                  workspaceId,
                  regionId: dialog.region.id,
                  data: { name: data.name },
                })
              : createRegion.mutateAsync({ workspaceId, data })
          }
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDeleteDialog
          title={t("workspace:datacenter.regions.deleteTitle", {
            code: dialog.region.code,
          })}
          description={t("workspace:datacenter.regions.deleteDescription")}
          onClose={close}
          onConfirm={() =>
            deleteRegion.mutateAsync({
              workspaceId,
              regionId: dialog.region.id,
            })
          }
        />
      )}
    </div>
  );
}
