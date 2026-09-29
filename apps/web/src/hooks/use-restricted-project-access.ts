import { useQuery } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";

/**
 * Whether the signed-in person sees only the projects they were added to in
 * the active workspace (true), or reaches every project (false: instance
 * administrator, workspace owner, or a role that grants
 * `workspace:manage_settings`). Undefined until known, and also when the check
 * failed: a failure never counts as "restricted", so no "no access" wording
 * appears on a guess.
 *
 * An empty project list means "nothing was created yet" for someone with full
 * access, and "you were not added to a project yet" for everyone else.
 */
export function useRestrictedProjectAccess(): boolean | undefined {
  const { user } = useAuth();
  const { workspace, role } = useWorkspacePermission();
  const workspaceId = workspace?.id;
  const isInstanceAdmin =
    (user as { role?: string | null } | null | undefined)?.role === "admin";
  const isOwner = role === "owner";

  const { data } = useQuery({
    queryKey: ["workspace-full-access", workspaceId, role],
    enabled: Boolean(workspaceId && role) && !isInstanceAdmin && !isOwner,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Asked directly: `hasPermission` of useWorkspacePermission turns a
      // failed request into "no", which would read as "restricted" here.
      const { data: result, error } =
        await authClient.organization.hasPermission({
          organizationId: workspaceId,
          permissions: { workspace: ["manage_settings"] },
        });
      if (error) throw new Error(error.message || "Permission check failed");
      return result?.success === true;
    },
  });

  if (isInstanceAdmin || isOwner) return false;
  if (data === undefined) return undefined;
  return !data;
}
