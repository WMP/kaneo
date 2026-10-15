import { isOwnerRole as isOwnerRoleName } from "../utils/project-access";

// Upstream signature (nullable role); the decision is the fork's.
export function isOwnerRole(role: string | null | undefined) {
  return typeof role === "string" && isOwnerRoleName(role);
}
