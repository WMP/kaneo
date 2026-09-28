import { Box, Wrench } from "lucide-react";
import type { AssigneeKind, ResourceKind } from "@/types/resource";

/** Icons standing in for a resource kind that has no photo of its own.
 * Only equipment/material get one — a "person" resource is rendered with
 * initials, same as a user, since it's still someone's name. Shared between
 * the assignee avatars and the assignee picker so both use the same icon
 * for a given kind. */
export const RESOURCE_KIND_ICONS: Partial<Record<ResourceKind, typeof Wrench>> =
  {
    equipment: Wrench,
    material: Box,
  };

export function getResourceKindIcon(kind: AssigneeKind | undefined) {
  if (!kind || kind === "user" || kind === "person") return undefined;
  return RESOURCE_KIND_ICONS[kind];
}
