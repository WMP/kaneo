import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";
export type InvitationProject = {
  id: string;
  name: string;
  /** The project role the invitation grants in this project. */
  role: string;
};

export type InvitationDetails = {
  id: string;
  email: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: string;
  status: string;
  expired: boolean;
  /** Empty or omitted for a plain workspace invitation. */
  projects?: InvitationProject[];
};

export type GetInvitationDetailsResponse = {
  valid: boolean;
  invitation?: InvitationDetails;
  error?: string;
};

export async function getInvitationDetails(
  invitationId: string,
): Promise<GetInvitationDetailsResponse> {
  const response = await client.invitation.public[":id"].$get({
    param: {
      id: invitationId,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const result = await response.json();
  return result;
}
