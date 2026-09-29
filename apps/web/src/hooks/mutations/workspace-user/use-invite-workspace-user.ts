import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { toWorkspaceMemberError } from "@/lib/workspace-role-error";
import queryClient from "@/query-client";

type InviteWorkspaceUserRequest = {
  workspaceId: string;
  email: string;
  // Custom workspace roles exist, so this is a role name, not a fixed union.
  role: string;
  resend?: boolean;
};

function useInviteWorkspaceUser() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      email,
      role,
      resend,
    }: InviteWorkspaceUserRequest) => {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        role,
        organizationId: workspaceId,
        resend,
      });

      if (error) {
        throw toWorkspaceMemberError(error);
      }

      return data;
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    },
  });
}

export default useInviteWorkspaceUser;
