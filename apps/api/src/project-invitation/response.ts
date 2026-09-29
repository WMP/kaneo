import { errorResponse, responseTimestamp, z } from "../openapi";

export const projectInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    workspaceRole: z.string(),
    projectRole: z.string(),
    projectId: z.string(),
    expiresAt: responseTimestamp,
    emailAttempted: z.boolean().openapi({
      description:
        "True when the API tried to send the invitation email. False when SMTP is not configured on this instance (share the accept link yourself) and when nothing was sent because the invitation already existed.",
    }),
    emailSent: z.boolean().openapi({
      description:
        "True when the email was handed to the SMTP relay. False when it was not attempted or the relay refused it (the failure is logged); use the resend route to try again. Delivery to the inbox is not confirmed.",
    }),
  })
  .openapi("ProjectInvitation");

export const projectInvitationListItemSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    workspaceRole: z.string(),
    projectRole: z.string(),
    expiresAt: responseTimestamp,
    inviterName: z.string(),
    status: z.enum(["live", "expired"]).openapi({
      description:
        "live: can still be accepted. expired: pending but past its expiry; resend is refused, invite the person again.",
    }),
  })
  .openapi("ProjectInvitationListItem");

export const projectInvitationListSchema = z.array(
  projectInvitationListItemSchema,
);

export const projectInvitationResendSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    expiresAt: responseTimestamp,
    emailAttempted: z.boolean(),
    emailSent: z.boolean(),
  })
  .openapi("ProjectInvitationResend");

export const projectInvitationCancelSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    canceled: z.boolean().openapi({
      description:
        "True when the invitation had no other project left and was canceled as a whole (its link stops working). False when it still grants other projects.",
    }),
  })
  .openapi("ProjectInvitationCancel");

export const memberCandidateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .openapi("ProjectMemberCandidate");

export const memberCandidateListSchema = z.array(memberCandidateSchema);

// Errors of this feature carry a machine-readable `code` next to the message
// (JSON); the shared access middleware still answers with plain text.
export const projectInvitationErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("ProjectInvitationError");

export function codedErrorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: projectInvitationErrorSchema },
      ...errorResponse(description).content,
    },
  };
}
