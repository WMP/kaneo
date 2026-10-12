import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export type InfrastructureStatus =
  | "planned"
  | "ordered"
  | "installed"
  | "suggested";

const VARIANT = {
  planned: "outline",
  ordered: "info",
  installed: "success",
  suggested: "warning",
} as const;

// Status of a host, a storage capacity entry or an order plan row.
export function InfrastructureStatusBadge({
  status,
}: {
  status: InfrastructureStatus;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant={VARIANT[status]}>
      {t(`common:infrastructureStatus.${status}`)}
    </Badge>
  );
}
