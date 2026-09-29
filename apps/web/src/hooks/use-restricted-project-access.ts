import { useQuery } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * Whether the signed-in person sees only the projects they were added to in
 * the active workspace (true), or reaches every project (false: instance
 * administrator, workspace owner, or a role that grants
 * `workspace:manage_settings`). Undefined until known, so callers show no
 * "no access" wording while it is still being checked.
 *
 * An empty project list means "nothing was created yet" for someone with full
 * access, and "you were not added to a project yet" for everyone else.
 */
export function useRestrictedProjectAccess(): boolean | undefined {
  const { user } = useAuth();
  const { workspace, role, hasPermission } = useWorkspacePermission();
  const workspaceId = workspace?.id;
  const isInstanceAdmin =
    (user as { role?: string | null } | null | undefined)?.role === "admin";
  const isOwner = role === "owner";

  const { data } = useQuery({
    queryKey: ["workspace-full-access", workspaceId, role],
    enabled: Boolean(workspaceId && role) && !isInstanceAdmin && !isOwner,
    staleTime: 5 * 60 * 1000,
    queryFn: () => hasPermission({ workspace: ["manage_settings"] }),
  });

  if (isInstanceAdmin || isOwner) return false;
  if (data === undefined) return undefined;
  return !data;
}
