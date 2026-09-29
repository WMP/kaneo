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
  email: z.string().trim().pipe(z.email()).optional().openapi({
    description:
      "Only for a person. Stored in lower case; not verified. It is the address an invitation sent from the resource goes to.",
  }),
});

export const updateResourceBody = z.object({
  name: z.string().min(1).optional(),
  // null clears a stored email; omit to leave it unchanged.
  email: z.string().trim().pipe(z.email()).nullable().optional().openapi({
    description:
      "Only for a person. Stored in lower case. Changing or clearing it detaches an invitation sent from the resource (that invitation stays valid for its old address).",
  }),
});

export const inviteResourceBody = z.object({
  workspaceRole: z.string().min(1).openapi({
    description:
      "The workspace role the person gets when they join: the built-in viewer, member or admin, or a custom role. Every permission it carries must also be held by the caller, and owner is never allowed.",
  }),
  projects: z
    .array(
      z.object({
        projectId: z.string().min(1),
        role: z.string().min(1).openapi({
          description:
            "The project role in that project: a role of the workspace catalog whose permissions the caller also holds in that project. owner is never a project role.",
        }),
      }),
    )
    .min(1)
    .max(100)
    .openapi({
      description:
        "The projects the invitation grants, each with its role. At least one; a project may appear once.",
    }),
});

export const linkResourceBody = z.object({
  userId: z.string().min(1).openapi({
    description: "A member of the resource's workspace.",
  }),
});
