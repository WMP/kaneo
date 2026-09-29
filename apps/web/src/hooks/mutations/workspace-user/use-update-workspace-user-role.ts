import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { invalidateAccessQueries } from "@/lib/invalidate-access-queries";
import { toWorkspaceMemberError } from "@/lib/workspace-role-error";

type UpdateWorkspaceUserRoleRequest = {
  workspaceId: string;
  memberId: string;
  role: string;
};

function useUpdateWorkspaceUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      memberId,
      role,
    }: UpdateWorkspaceUserRoleRequest) => {
      const { data, error } = await authClient.organization.updateMemberRole({
        memberId,
        organizationId: workspaceId,
        role: role as "admin" | "member" | "owner",
      });

      if (error) {
        throw toWorkspaceMemberError(error);
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      // The members page reads from useGetFullWorkspace which keys by
      // ["workspace", "full", workspaceId], so invalidate that exact prefix
      // so the table re-renders with the new role.
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-members", variables.workspaceId],
      });
      // useGetActiveWorkspaceUser is keyed ["workspace-user", "active", ...]
      // and drives sidebar/role badges for the current user.
      queryClient.invalidateQueries({
        queryKey: ["workspace-user", "active"],
      });
      // The active user's role may have changed; capability cache is keyed
      // by (workspaceId, role) so we drop the per-workspace cache.
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
      // The person's capabilities in every project change with their role.
      void invalidateAccessQueries(queryClient);
      // No assignable-roles invalidation here: what the caller may grant
      // depends only on the caller's own role and the workspace's roles.
      // Changing another member's role affects neither, and the API rejects a
      // change to the caller's own role. Workspace role edits and ownership
      // transfer invalidate that list themselves.
    },
  });
}

export default useUpdateWorkspaceUserRole;
