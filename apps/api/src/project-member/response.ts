import { z } from "../openapi";

export const projectMemberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().openapi({
      description:
        "For a project member, the project role. For a full-access member, their workspace role.",
    }),
    source: z.enum(["project", "full-access"]).openapi({
      description:
        "project: access comes from a membership of this project, which can be changed or removed. full-access: the person reaches every project of the workspace through their workspace role (owner, or a role granting workspace:manage_settings) or as instance administrator, and cannot be changed or removed here.",
    }),
  })
  .openapi("ProjectMember");

export const projectMemberListSchema = z.array(projectMemberSchema);
