import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const projectInvitationParam = z.object({
  projectId: z.string(),
  invitationId: z.string(),
});

export const createProjectInvitationBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()).openapi({
    description:
      "The invitee's email address. It is lower-cased; Better Auth matches it against the account's email when the invitation is accepted.",
  }),
  workspaceRole: z.string().min(1).openapi({
    description:
      "The workspace role the invitee gets when they join: the built-in viewer, member or admin, or a custom role. Every permission it carries must also be held by the caller, and owner is never allowed.",
  }),
  projectRole: z.string().min(1).openapi({
    description:
      "The project role the invitee gets in this project once they accept: a role of the workspace catalog whose permissions the caller also holds in this project. owner is never a project role.",
  }),
});
