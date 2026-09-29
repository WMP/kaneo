import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignableRolesWorkspaceKey } from "@/hooks/queries/workspace/use-get-assignable-roles";
import { authClient } from "@/lib/auth-client";
import { invalidateAccessQueries } from "@/lib/invalidate-access-queries";

type DeleteWorkspaceRoleRequest = {
  workspaceId: string;
  roleName: string;
};

function useDeleteWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      roleName,
    }: DeleteWorkspaceRoleRequest) => {
      const { data, error } = await authClient.organization.deleteRole({
        organizationId: workspaceId,
        roleName,
      });
      if (error) {
        throw new Error(error.message || "Failed to delete role");
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-roles", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: assignableRolesWorkspaceKey(variables.workspaceId),
      });
      void invalidateAccessQueries(queryClient);
    },
  });
}

export default useDeleteWorkspaceRole;
