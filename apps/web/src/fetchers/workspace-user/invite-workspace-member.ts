import { authClient } from "@/lib/auth-client";
import { toWorkspaceMemberError } from "@/lib/workspace-role-error";

export type InviteWorkspaceMemberRequest = {
  workspaceId: string;
  email: string;
  role?: string;
};

const inviteWorkspaceMember = async ({
  workspaceId,
  email,
  role = "member",
}: InviteWorkspaceMemberRequest) => {
  const { data, error } = await authClient.organization.inviteMember({
    organizationId: workspaceId,
    email,
    role,
  });

  if (error) {
    throw toWorkspaceMemberError(error);
  }

  return data;
};

export default inviteWorkspaceMember;
