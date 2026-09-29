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
    description: "A member of the project's workspace.",
  }),
  role: roleField,
});

export const updateProjectMemberBody = z.object({
  role: roleField,
});
