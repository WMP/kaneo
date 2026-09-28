import { z } from "../openapi";

export const RESOURCE_KINDS = ["person", "equipment", "material"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const resourceKindSchema = z.enum(RESOURCE_KINDS);

export const workspaceIdParam = z.object({
  workspaceId: z.string(),
});

export const resourceIdParam = z.object({
  id: z.string(),
});

export const listResourcesQuery = z.object({
  kind: resourceKindSchema.optional().openapi({
    description:
      "Restrict the list to one kind: person, equipment, or material.",
  }),
});

export const createResourceBody = z.object({
  kind: resourceKindSchema,
  name: z.string().min(1).openapi({ description: "Display name." }),
  email: z.string().email().optional().openapi({
    description:
      "Not verified or emailed in this phase; stored for a later invite flow.",
  }),
});

export const updateResourceBody = z.object({
  name: z.string().min(1).optional(),
  // null clears a stored email; omit to leave it unchanged.
  email: z.string().email().nullable().optional(),
});
