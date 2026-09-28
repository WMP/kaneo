import { responseTimestamp, z } from "../openapi";

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
        "Linked Kaneo account, if any. Always null in this phase — set later by an email/OIDC invite flow.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Resource");

export const resourceListSchema = z.array(resourceSchema);
