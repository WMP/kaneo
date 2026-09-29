import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignableRolesWorkspaceKey } from "@/hooks/queries/workspace/use-get-assignable-roles";
import { authClient } from "@/lib/auth-client";
import { invalidateAccessQueries } from "@/lib/invalidate-access-queries";
import { toWorkspaceMemberError } from "@/lib/workspace-role-error";

type UpdateWorkspaceRoleRequest = {
  workspaceId: string;
  roleName: string;
  permission: Record<string, string[]>;
};

function useUpdateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      roleName,
      permission,
    }: UpdateWorkspaceRoleRequest) => {
      const { data, error } = await authClient.organization.updateRole({
        organizationId: workspaceId,
        roleName,
        data: { permission },
      });
      if (error) throw toWorkspaceMemberError(error);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-roles", variables.workspaceId],
      });
      // The role's permission set just changed, so any cached capability
      // map for members assigned to this role is now stale.
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
      // Members and project members holding this role now act with other
      // permissions in their projects.
      void invalidateAccessQueries(queryClient);
      // The permission set decides which callers may assign this role.
      queryClient.invalidateQueries({
        queryKey: assignableRolesWorkspaceKey(variables.workspaceId),
      });
    },
  });
}

export default useUpdateWorkspaceRole;
