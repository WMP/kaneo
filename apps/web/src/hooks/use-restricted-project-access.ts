import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * Whether the signed-in person sees only the projects they were added to in
 * the active workspace (true), or reaches every project (false: instance
 * administrator, workspace owner, or a role that grants
 * `workspace:manage_settings`). Undefined until known, so no "no access"
 * wording appears on a guess.
 *
 * An empty project list means "nothing was created yet" for someone with full
 * access, and "you were not added to a project yet" for everyone else.
 *
 * The `manageSettings` capability of `useWorkspacePermission` answers it, so a
 * role change refreshes it through that hook's own invalidation.
 */
export function useRestrictedProjectAccess(): boolean | undefined {
  const { user } = useAuth();
  const { role, canManageSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const isInstanceAdmin =
    (user as { role?: string | null } | null | undefined)?.role === "admin";

  if (isInstanceAdmin || role === "owner") return false;
  if (!role || isCheckingPermissions) return undefined;
  return !canManageSettings();
}
