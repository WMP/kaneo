import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { HostStatus } from "@/fetchers/infrastructure/datacenter/set-host-status";
import { getDatacenterErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { DcSelect } from "./dc-select";

export type StatusChange = {
  status: HostStatus;
  availableFrom?: string | null;
  hostname: string | null;
};

type StatusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the status belongs to: a host label or a capacity entry label. */
  subject: string;
  initial: {
    status: HostStatus;
    availableFrom: string | null;
    hostname: string | null;
  };
  onSubmit: (change: StatusChange) => Promise<unknown>;
};

const STATUSES: HostStatus[] = ["planned", "ordered", "installed"];

// Changes the status of a host or of a Ceph capacity entry. `ordered` needs the
// expected delivery date; `installed` may leave it empty (the API stores today);
// `planned` clears it.
export function StatusDialog({
  open,
  onOpenChange,
  subject,
  initial,
  onSubmit,
}: StatusDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HostStatus>(initial.status);
  const [availableFrom, setAvailableFrom] = useState(
    initial.availableFrom ?? "",
  );
  const [hostname, setHostname] = useState(initial.hostname ?? "");
  const [pending, setPending] = useState(false);

  const dateRequired = status === "ordered";
  const dateDisabled = status === "planned";
  const canSave = !pending && !(dateRequired && availableFrom === "");

  const handleSubmit = async () => {
    if (!canSave) return;
    setPending(true);
    try {
      await onSubmit({
        status,
        availableFrom: status === "planned" ? null : availableFrom || undefined,
        hostname: hostname.trim() || null,
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
              {t("workspace:datacenter.statusDialog.title")}
            </DialogTitle>
            <DialogDescription>{subject}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.status")}</FieldLabel>
              <DcSelect
                className="w-full"
                ariaLabel={t("workspace:datacenter.fields.status")}
                value={status}
                onChange={(next) => setStatus(next as HostStatus)}
                options={STATUSES.map((value) => ({
                  value,
                  label: t(`common:infrastructureStatus.${value}`),
                }))}
              />
            </Field>
            <Field>
              <FieldLabel>
                {t("workspace:datacenter.fields.availableFrom")}
              </FieldLabel>
              <Input
                type="date"
                nativeInput
                aria-label={t("workspace:datacenter.fields.availableFrom")}
                value={dateDisabled ? "" : availableFrom}
                disabled={dateDisabled}
                required={dateRequired}
                onChange={(event) => setAvailableFrom(event.target.value)}
              />
              <FieldDescription>
                {dateRequired
                  ? t("workspace:datacenter.statusDialog.dateRequired")
                  : t("workspace:datacenter.statusDialog.dateOptional")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>
                {t("workspace:datacenter.fields.hostname")}
              </FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.fields.hostname")}
                maxLength={255}
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
              />
            </Field>
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
            <Button type="submit" size="sm" disabled={!canSave}>
              {t("workspace:datacenter.actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
