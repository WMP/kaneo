import { responseTimestamp, z } from "../openapi";
import { codedErrorResponse } from "../utils/coded-error";

export { codedErrorResponse };

export const resourceSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    kind: z.string().openapi({
      description: "One of: person, equipment, material.",
    }),
    name: z.string(),
    email: z.string().nullable(),
    userId: z.string().nullable().openapi({
      description:
        "The linked Kaneo account, if any. Set when the person accepts an invitation sent from the resource, or by linking the resource to a member. Assignments of the resource in projects the account can open were moved to the account.",
    }),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        image: z.string().nullable(),
      })
      .nullable()
      .openapi({
        description:
          "The linked account as the caller may see it (the members list rules); null when the resource is not linked, or the caller cannot see that member.",
      }),
    invitation: z
      .object({
        status: z.enum(["pending", "expired"]),
        expiresAt: responseTimestamp,
      })
      .nullable()
      .openapi({
        description:
          "The invitation sent from the resource, while it can still be accepted (pending) or is past its expiry (expired). Null when there is none, or it was canceled or rejected.",
      }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Resource");

export const resourceListSchema = z.array(resourceSchema);

export const resourceInvitationSchema = z
  .object({
    id: z.string().openapi({
      description:
        "The invitation id; the accept link is /invitation/accept/{id}.",
    }),
    created: z.boolean().openapi({
      description:
        "False when a live pending invitation for this address and workspace role already existed and the projects were added to it (no second email).",
    }),
    email: z.string(),
    workspaceRole: z.string(),
    projects: z.array(z.object({ projectId: z.string(), role: z.string() })),
    expiresAt: responseTimestamp,
    emailAttempted: z.boolean().openapi({
      description:
        "True when the API tried to send the invitation email. False when SMTP is not configured (share the accept link yourself) and when nothing was sent because the invitation already existed.",
    }),
    emailSent: z.boolean().openapi({
      description:
        "True when the email was handed to the SMTP relay. False when it was not attempted or the relay refused it.",
    }),
  })
  .openapi("ResourceInvitation");

export const resourceInviteDefaultsSchema = z
  .object({
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        hasAssignments: z.boolean().openapi({
          description:
            "True when the resource is assigned to a task of the project: the projects to pre-select.",
        }),
      }),
    ),
  })
  .openapi("ResourceInviteDefaults");

export const resourceLinkSchema = z
  .object({
    resource: resourceSchema,
    movedTaskCount: z.number().int().openapi({
      description:
        "The number of tasks whose assignment moved from the resource to the account.",
    }),
  })
  .openapi("ResourceLink");
