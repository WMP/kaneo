import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignableRolesWorkspaceKey } from "@/hooks/queries/workspace/use-get-assignable-roles";
import { authClient } from "@/lib/auth-client";

type CreateWorkspaceRoleRequest = {
  workspaceId: string;
  role: string;
  permission: Record<string, string[]>;
};

function useCreateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      role,
      permission,
    }: CreateWorkspaceRoleRequest) => {
      const { data, error } = await authClient.organization.createRole({
        organizationId: workspaceId,
        role,
        permission,
      });
      if (error) {
        throw new Error(error.message || "Failed to create role");
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
    },
  });
}

export default useCreateWorkspaceRole;
