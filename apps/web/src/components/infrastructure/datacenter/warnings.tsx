import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDay } from "./format";
import type { CapacityWarning, WorkspaceCapacity } from "./types";

const SEVERITIES = ["error", "warning", "info"] as const;
const SEVERITY_BADGE = {
  error: "error",
  warning: "warning",
  info: "info",
} as const;
const PREVIEW_COUNT = 5;

// Static keys keep the i18n checker able to see every string in use.
const WITH_DATE_KEYS = {
  HOST_NOT_READY: "workspace:datacenter.warnings.HOST_NOT_READY",
  ORDER_LATE: "workspace:datacenter.warnings.ORDER_LATE",
  OVER_100: "workspace:datacenter.warnings.OVER_100",
  OVER_80: "workspace:datacenter.warnings.OVER_80",
  CLUSTER_NOT_READY: "workspace:datacenter.warnings.CLUSTER_NOT_READY",
  CLUSTER_SHORTFALL: "workspace:datacenter.warnings.CLUSTER_SHORTFALL",
} as const;

type Names = { hosts: Map<string, string>; clusters: Map<string, string> };

export function namesOf(capacity: WorkspaceCapacity): Names {
  return {
    hosts: new Map(capacity.hosts.map(({ host }) => [host.id, host.label])),
    clusters: new Map(
      capacity.clusters.map(({ cluster }) => [cluster.id, cluster.name]),
    ),
  };
}

/** The translated sentence for one warning. Warnings carry VM and project names, never task titles. */
export function useWarningText(names: Names) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  return (warning: CapacityWarning): string => {
    const target =
      (warning.hostId ? names.hosts.get(warning.hostId) : undefined) ??
      (warning.clusterId ? names.clusters.get(warning.clusterId) : undefined) ??
      "–";
    const params = {
      target,
      host: target,
      vm: warning.vmName ?? "–",
      project: warning.projectName ?? "–",
      date: warning.date ? formatDay(warning.date, locale) : "–",
    };
    switch (warning.type) {
      case "VM_UNPLACED":
        return t("workspace:datacenter.warnings.VM_UNPLACED", params);
      case "VM_UNSCHEDULED":
        return t("workspace:datacenter.warnings.VM_UNSCHEDULED", params);
      case "CLUSTER_SHORTFALL":
        return warning.date
          ? t(WITH_DATE_KEYS.CLUSTER_SHORTFALL, params)
          : t(
              "workspace:datacenter.warnings.CLUSTER_SHORTFALL_NO_DATE",
              params,
            );
      default:
        return t(WITH_DATE_KEYS[warning.type], params);
    }
  };
}

export function WarningList({
  warnings,
  names,
}: {
  warnings: CapacityWarning[];
  names: Names;
}) {
  const { t } = useTranslation();
  const text = useWarningText(names);
  return (
    <ul className="space-y-1.5">
      {warnings.map((warning, index) => (
        <li
          // A warning has no id of its own.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          className="flex items-start gap-2 text-sm"
        >
          <Badge
            variant={SEVERITY_BADGE[warning.severity]}
            size="sm"
            className="mt-0.5"
          >
            {t(
              `workspace:datacenter.warnings.severityName.${warning.severity}`,
            )}
          </Badge>
          <span>{text(warning)}</span>
        </li>
      ))}
    </ul>
  );
}

// Counts by severity and the first few warnings of the whole workspace.
export function WarningsSummary({
  warnings,
  names,
}: {
  warnings: CapacityWarning[];
  names: Names;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const counts = useMemo(
    () =>
      SEVERITIES.map((severity) => ({
        severity,
        count: warnings.filter((w) => w.severity === severity).length,
      })),
    [warnings],
  );
  const ordered = useMemo(
    () =>
      [...warnings].sort(
        (a, b) =>
          SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
      ),
    [warnings],
  );

  if (warnings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("workspace:datacenter.warnings.none")}
      </p>
    );
  }

  const shown = expanded ? ordered : ordered.slice(0, PREVIEW_COUNT);

  return (
    <section
      className="space-y-2 rounded-md border bg-sidebar p-3"
      aria-label={t("workspace:datacenter.warnings.title")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">
          {t("workspace:datacenter.warnings.title")}
        </h2>
        {counts
          .filter(({ count }) => count > 0)
          .map(({ severity, count }) => (
            <Badge key={severity} variant={SEVERITY_BADGE[severity]}>
              {t(`workspace:datacenter.warnings.severity.${severity}`, {
                total: count,
              })}
            </Badge>
          ))}
      </div>
      <WarningList warnings={shown} names={names} />
      {ordered.length > PREVIEW_COUNT && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("workspace:datacenter.warnings.showFewer")
            : t("workspace:datacenter.warnings.showAll", {
                total: ordered.length,
              })}
        </Button>
      )}
    </section>
  );
}
