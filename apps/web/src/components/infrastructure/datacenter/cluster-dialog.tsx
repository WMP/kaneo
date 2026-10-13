import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StorageClusterInput } from "@/fetchers/infrastructure/datacenter/create-storage-cluster";
import { getDatacenterErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { DcSelect } from "./dc-select";
import type { StorageCluster } from "./types";

type Kind = StorageClusterInput["kind"];

function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

// Creates or edits a Ceph storage cluster. Erasure coding (k data and m coding
// chunks) exists only for a self-managed cluster; a managed service has neither.
export function ClusterDialog({
  open,
  onOpenChange,
  cluster,
  regions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The cluster being edited; omit to create one. */
  cluster?: StorageCluster;
  /** The workspace's region catalog. */
  regions: { code: string; name: string }[];
  onSubmit: (data: StorageClusterInput) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(cluster?.name ?? "");
  const [region, setRegion] = useState(cluster?.region ?? "");
  const [kind, setKind] = useState<Kind>(cluster?.kind ?? "self_managed");
  const [k, setK] = useState(String(cluster?.ecDataChunks ?? 4));
  const [m, setM] = useState(String(cluster?.ecCodingChunks ?? 2));
  const [threshold, setThreshold] = useState(
    String(cluster?.fillThresholdPercent ?? 80),
  );
  const [leadTime, setLeadTime] = useState(String(cluster?.leadTimeDays ?? 0));
  const [pending, setPending] = useState(false);

  // The region of an edited cluster stays selectable even if it left the
  // catalog, so the dialog never shows an empty value for saved data.
  const regionOptions = [
    ...regions.map((item) => ({
      value: item.code,
      label: `${item.code} — ${item.name}`,
    })),
    ...(region && !regions.some((item) => item.code === region)
      ? [{ value: region, label: region }]
      : []),
  ];

  const selfManaged = kind === "self_managed";
  const kValue = toInt(k);
  const mValue = toInt(m);
  const thresholdValue = toInt(threshold);
  const leadTimeValue = toInt(leadTime);
  const valid =
    name.trim() !== "" &&
    region !== "" &&
    thresholdValue != null &&
    thresholdValue >= 1 &&
    thresholdValue <= 100 &&
    leadTimeValue != null &&
    leadTimeValue >= 0 &&
    (!selfManaged ||
      (kValue != null && kValue >= 1 && mValue != null && mValue >= 1));

  const handleSubmit = async () => {
    if (!valid || pending) return;
    setPending(true);
    try {
      await onSubmit({
        name: name.trim(),
        region,
        kind,
        ecDataChunks: selfManaged ? kValue : null,
        ecCodingChunks: selfManaged ? mValue : null,
        fillThresholdPercent: thresholdValue as number,
        leadTimeDays: leadTimeValue as number,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getDatacenterErrorMessage(
          error,
          t,
          "workspace:datacenter.errors.saveFailed",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {cluster
                ? t("workspace:datacenter.clusterDialog.editTitle")
                : t("workspace:datacenter.clusterDialog.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.name")}</FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.fields.name")}
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.region")}</FieldLabel>
              <DcSelect
                className="w-full"
                ariaLabel={t("workspace:datacenter.fields.region")}
                value={region}
                onChange={setRegion}
                options={regionOptions}
                placeholder={t(
                  "workspace:datacenter.clusterDialog.regionPlaceholder",
                )}
              />
              {regions.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  {t("workspace:datacenter.clusterDialog.noRegions")}
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.kind")}</FieldLabel>
              <DcSelect
                className="w-full"
                ariaLabel={t("workspace:datacenter.fields.kind")}
                value={kind}
                onChange={(next) => setKind(next as Kind)}
                options={[
                  {
                    value: "self_managed",
                    label: t("workspace:datacenter.kind.self_managed"),
                  },
                  {
                    value: "managed_service",
                    label: t("workspace:datacenter.kind.managed_service"),
                  },
                ]}
              />
            </Field>
            {selfManaged && (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>
                    {t("workspace:datacenter.fields.dataChunks")}
                  </FieldLabel>
                  <Input
                    nativeInput
                    type="number"
                    min={1}
                    max={1000}
                    aria-label={t("workspace:datacenter.fields.dataChunks")}
                    value={k}
                    onChange={(event) => setK(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t("workspace:datacenter.fields.codingChunks")}
                  </FieldLabel>
                  <Input
                    nativeInput
                    type="number"
                    min={1}
                    max={1000}
                    aria-label={t("workspace:datacenter.fields.codingChunks")}
                    value={m}
                    onChange={(event) => setM(event.target.value)}
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>
                  {t("workspace:datacenter.fields.fillThreshold")}
                </FieldLabel>
                <Input
                  nativeInput
                  type="number"
                  min={1}
                  max={100}
                  aria-label={t("workspace:datacenter.fields.fillThreshold")}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t("workspace:datacenter.fields.leadTimeDays")}
                </FieldLabel>
                <Input
                  nativeInput
                  type="number"
                  min={0}
                  max={3650}
                  aria-label={t("workspace:datacenter.fields.leadTimeDays")}
                  value={leadTime}
                  onChange={(event) => setLeadTime(event.target.value)}
                />
              </Field>
            </div>
            <p className="text-muted-foreground text-xs">
              {selfManaged
                ? t("workspace:datacenter.clusterDialog.selfManagedHint")
                : t("workspace:datacenter.clusterDialog.managedHint")}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!valid || pending}>
              {t("workspace:datacenter.actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
