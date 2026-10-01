import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const projectMemberParam = z.object({
  projectId: z.string(),
  userId: z.string(),
});

const roleField = z.string().min(1).openapi({
  description:
    "A workspace role name: the built-in viewer, member or admin, or a custom role of the workspace. Its permissions apply inside this project only. owner is never a project role.",
});

export const addProjectMemberBody = z.object({
  userId: z.string().min(1).openapi({
    description:
      "A member of the project's workspace, or (with workspaceRole) an existing account that is not a member of it yet.",
  }),
  role: roleField,
  workspaceRole: z.string().min(1).optional().openapi({
    description:
      "Only for an account that is NOT a member of the workspace yet: the workspace role it gets, so it is added to the workspace and the project in one step. The caller also needs member:create in their WORKSPACE role, and the role must be within the caller's own workspace permissions (owner is never allowed). For somebody who already is a workspace member the request is refused (409 ALREADY_WORKSPACE_MEMBER): leave it out.",
  }),
});

export const updateProjectMemberBody = z.object({
  role: roleField,
});
