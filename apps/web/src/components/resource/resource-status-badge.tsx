import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type Resource from "@/types/resource";

export type ResourceStatus =
  | { kind: "linked"; name: string | null }
  | { kind: "invited"; state: "pending" | "expired" }
  | { kind: "not-invited" };

/** How a person resource stands: linked to an account (the name is null for a
 * caller who cannot see that member), invited, or neither. Only persons have a
 * status. */
export function getResourceStatus(resource: Resource): ResourceStatus | null {
  if (resource.kind !== "person") return null;
  if (resource.userId) {
    return { kind: "linked", name: resource.user?.name ?? null };
  }
  if (resource.invitation) {
    return { kind: "invited", state: resource.invitation.status };
  }
  return { kind: "not-invited" };
}

type Props = { resource: Resource };

function ResourceStatusBadge({ resource }: Props) {
  const { t } = useTranslation();
  const status = getResourceStatus(resource);
  if (!status) return null;

  if (status.kind === "linked") {
    return (
      <Badge variant="success" size="sm" className="max-w-56 truncate">
        {status.name
          ? t("settings:workspaceResources.status.linkedTo", {
              name: status.name,
            })
          : t("settings:workspaceResources.status.linked")}
      </Badge>
    );
  }
  if (status.kind === "invited") {
    return (
      <Badge
        variant={status.state === "expired" ? "warning" : "info"}
        size="sm"
      >
        {status.state === "expired"
          ? t("settings:workspaceResources.status.invitedExpired")
          : t("settings:workspaceResources.status.invitedPending")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size="sm">
      {t("settings:workspaceResources.status.notInvited")}
    </Badge>
  );
}

export default ResourceStatusBadge;
