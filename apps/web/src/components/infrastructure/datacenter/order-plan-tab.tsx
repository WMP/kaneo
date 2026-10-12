import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfrastructureStatusBadge } from "@/components/infrastructure/status-badge";
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
import { useDownloadOrderPlan } from "@/hooks/mutations/infrastructure/datacenter/use-datacenter-mutations";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { formatDay, formatGb, formatNumber, providerName } from "./format";
import type { OrderPlanRow } from "./types";

const TYPE_KEYS = {
  host: "workspace:datacenter.orderPlan.types.host",
  storage_node: "workspace:datacenter.orderPlan.types.storageNode",
  storage_service: "workspace:datacenter.orderPlan.types.storageService",
} as const;

export function OrderPlanTab({
  workspaceId,
  rows,
}: {
  workspaceId: string;
  rows: OrderPlanRow[];
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const download = useDownloadOrderPlan();
  const lateCount = rows.filter((row) => row.late).length;

  const handleDownload = async () => {
    try {
      await download.mutateAsync(workspaceId);
    } catch (error) {
      toast.error(
        getInfrastructureErrorMessage(
          error,
          t,
          "workspace:datacenter.orderPlan.downloadFailed",
        ),
      );
    }
  };

  const dash = "–";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {t("workspace:datacenter.orderPlan.rows", { rows: rows.length })}
          </Badge>
          <Badge variant={lateCount > 0 ? "error" : "outline"}>
            {t("workspace:datacenter.orderPlan.late", { late: lateCount })}
          </Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={download.isPending}
          onClick={() => void handleDownload()}
        >
          <Download />
          {t("workspace:datacenter.orderPlan.download")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("workspace:datacenter.orderPlan.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("workspace:datacenter.orderPlan.orderBy")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.needDate")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.orderPlan.type")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.provider")}
                </TableHead>
                <TableHead>{t("workspace:datacenter.fields.region")}</TableHead>
                <TableHead>{t("workspace:datacenter.fields.model")}</TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.fields.ramGb")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.fields.vcpu")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.fields.storageGb")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.orderPlan.quantity")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.fields.capacity")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.project")}
                </TableHead>
                <TableHead>
                  {t("workspace:datacenter.fields.cluster")}
                </TableHead>
                <TableHead>{t("workspace:datacenter.fields.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => {
                const provider = providerName(row.provider);
                return (
                  <TableRow
                    // The plan has no row id; the order is stable per response.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={index}
                    data-late={row.late || undefined}
                  >
                    <TableCell className="whitespace-nowrap">
                      {row.orderByDate ? (
                        <span className="flex items-center gap-2">
                          <span
                            className={
                              row.late
                                ? "font-medium text-destructive-foreground"
                                : undefined
                            }
                          >
                            {formatDay(row.orderByDate, locale)}
                          </span>
                          {row.late && (
                            <Badge variant="error" size="sm">
                              {t("workspace:datacenter.orderPlan.lateBadge")}
                            </Badge>
                          )}
                        </span>
                      ) : (
                        dash
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.needDate ? formatDay(row.needDate, locale) : dash}
                    </TableCell>
                    <TableCell>{t(TYPE_KEYS[row.type])}</TableCell>
                    <TableCell>
                      {row.provider == null
                        ? dash
                        : (provider ??
                          t("workspace:datacenter.provider.other"))}
                    </TableCell>
                    <TableCell>{row.region}</TableCell>
                    <TableCell>{row.model ?? dash}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ramGb == null
                        ? dash
                        : formatNumber(row.ramGb, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.vcpu == null ? dash : formatNumber(row.vcpu, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.storageGb == null
                        ? dash
                        : formatNumber(row.storageGb, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.quantity, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.capacityGb == null
                        ? dash
                        : formatGb(row.capacityGb, locale)}
                    </TableCell>
                    <TableCell>{row.projectName ?? dash}</TableCell>
                    <TableCell>{row.clusterName ?? dash}</TableCell>
                    <TableCell>
                      <InfrastructureStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
