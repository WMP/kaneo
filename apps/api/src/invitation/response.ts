import { responseTimestamp, z } from "../openapi";

export const invitationProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string().openapi({
      description: "The project role the invitation grants in this project.",
    }),
  })
  .openapi("InvitationProject");

const invitationProjectsField = z
  .array(invitationProjectSchema)
  .optional()
  .openapi({
    description:
      "Projects that accepting the invitation adds the person to, with their project role, for invitations created through the project invitation routes. Empty or omitted for a plain workspace invitation, in which case the person sees no project until they are added.",
  });

export const pendingInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    inviterName: z.string(),
    expiresAt: responseTimestamp,
    createdAt: responseTimestamp,
    status: z.string().openapi({
      description:
        "Always `pending` here; expired and accepted ones are filtered out.",
    }),
    projects: invitationProjectsField,
  })
  .openapi("PendingInvitation");

export const pendingInvitationListSchema = z.array(pendingInvitationSchema);

export const invitationDetailsSchema = z
  .object({
    valid: z.boolean().openapi({
      description: "True only when the invitation can still be accepted.",
    }),
    invitation: z
      .object({
        id: z.string(),
        email: z.string(),
        workspaceName: z.string(),
        inviterName: z.string(),
        expiresAt: responseTimestamp,
        status: z.string(),
        expired: z.boolean(),
        projects: invitationProjectsField,
      })
      .optional()
      .openapi({
        description:
          "Omitted when the invitation does not exist, was already accepted, or was canceled -- the details are withheld rather than leaked.",
      }),
    error: z.string().optional().openapi({
      description: "Why the invitation is unusable, when valid is false.",
    }),
  })
  .openapi("InvitationDetails");
