import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { track } from "@/lib/analytics/track";
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
  const { t } = useTranslation();
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

      if (error?.code === "INVITATION_EMAIL_FAILED") {
        throw new Error(t("settings:invitationEmailFailed"));
      }
      if (error) {
        throw toWorkspaceMemberError(error);
      }

      return data;
    },
    onSuccess: (_data, { resend }) => {
      if (!resend) track("Invite Sent");
    },
    onSettled: (_, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
    },
  });
}

export default useInviteWorkspaceUser;
