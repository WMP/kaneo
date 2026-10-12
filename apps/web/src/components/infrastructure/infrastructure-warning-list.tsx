import { Link } from "@tanstack/react-router";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  ProjectCapacityWarning,
  ProjectHostCapacity,
} from "@/fetchers/infrastructure/get-project-capacity";
import { formatInfraDate } from "@/lib/infrastructure-format";

type Props = {
  warnings: ProjectCapacityWarning[];
  hosts: ProjectHostCapacity[];
  // With both ids, a warning that names a task links to it.
  workspaceId?: string;
  projectId?: string;
};

const SEVERITY_ICON = {
  error: { Icon: CircleAlert, className: "text-destructive-foreground" },
  warning: { Icon: TriangleAlert, className: "text-warning-foreground" },
  info: { Icon: Info, className: "text-info-foreground" },
} as const;

// One translated sentence per warning type, with its VM, host and dates.
export function InfrastructureWarningList({
  warnings,
  hosts,
  workspaceId,
  projectId,
}: Props) {
  const { t } = useTranslation();
  const hostById = new Map(hosts.map((entry) => [entry.host.id, entry.host]));

  const describe = (warning: ProjectCapacityWarning) => {
    const host = warning.hostId ? hostById.get(warning.hostId) : undefined;
    const values = {
      vm: warning.vmName ?? "",
      host: host?.label ?? "",
      date: warning.date ? formatInfraDate(warning.date) : "",
      available: host?.availableFrom ? formatInfraDate(host.availableFrom) : "",
    };
    switch (warning.type) {
      case "HOST_NOT_READY":
        return host && host.status !== "planned" && host.availableFrom
          ? t(
              "settings:projectInfrastructure.warnings.types.hostNotReadyAvailable",
              values,
            )
          : t(
              "settings:projectInfrastructure.warnings.types.hostNotReadyPlanned",
              values,
            );
      case "ORDER_LATE":
        return t(
          "settings:projectInfrastructure.warnings.types.orderLate",
          values,
        );
      case "OVER_100":
        return t(
          "settings:projectInfrastructure.warnings.types.over100",
          values,
        );
      case "OVER_80":
        return t(
          "settings:projectInfrastructure.warnings.types.over80",
          values,
        );
      case "VM_UNPLACED":
        return t(
          "settings:projectInfrastructure.warnings.types.vmUnplaced",
          values,
        );
      case "VM_UNSCHEDULED":
        return t(
          "settings:projectInfrastructure.warnings.types.vmUnscheduled",
          values,
        );
      default:
        return t("settings:projectInfrastructure.warnings.types.unknown");
    }
  };

  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((warning, index) => {
        const { Icon, className } = SEVERITY_ICON[warning.severity];
        const key = [
          warning.type,
          warning.hostId,
          warning.vmId,
          warning.taskId,
          index,
        ].join(":");
        return (
          <li
            key={key}
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            data-severity={warning.severity}
          >
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${className}`}
              aria-label={t(
                `settings:projectInfrastructure.warnings.severity.${warning.severity}`,
              )}
            />
            <div className="min-w-0 flex-1">
              <span>{describe(warning)}</span>
              {workspaceId && projectId && warning.taskId && (
                <>
                  {" "}
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                    params={{
                      workspaceId,
                      projectId,
                      taskId: warning.taskId,
                    }}
                    className="font-medium underline underline-offset-2"
                  >
                    {warning.taskTitle}
                  </Link>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
