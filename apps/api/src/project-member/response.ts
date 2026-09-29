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
    active: z.boolean().openapi({
      description:
        "False for a project membership whose role grants nothing (for example the role was deleted or the project moved to another workspace). Such a member has no access; a caller who may manage members can remove or re-assign them.",
    }),
  })
  .openapi("ProjectMember");

export const projectMemberListSchema = z.array(projectMemberSchema);

export const projectAccessSchema = z
  .object({
    mode: z.enum(["full", "member"]).openapi({
      description:
        "full: the caller reaches every project of the workspace (instance administrator, workspace owner, or a role granting workspace:manage_settings) and acts with their workspace role. member: access comes from a project membership and the project role applies.",
    }),
    role: z.string().nullable().openapi({
      description:
        "The project role for mode member, the workspace role for mode full (null for an instance administrator who is not a workspace member).",
    }),
    capabilities: z
      .object({
        createTasks: z.boolean(),
        updateTasks: z.boolean(),
        deleteTasks: z.boolean(),
        assignTasks: z.boolean(),
        createLabels: z.boolean(),
        updateLabels: z.boolean(),
        deleteLabels: z.boolean(),
        updateProject: z.boolean(),
        deleteProject: z.boolean(),
        shareProject: z.boolean(),
        manageMembers: z.boolean().openapi({
          description: "member:create, member:update or member:delete.",
        }),
        addMembers: z.boolean().openapi({ description: "member:create." }),
        inviteToProject: z
          .boolean()
          .openapi({ description: "invitation:create." }),
        cancelProjectInvitations: z
          .boolean()
          .openapi({ description: "invitation:cancel." }),
        manageIntegrations: z.boolean().openapi({
          description:
            "workspace:manage_settings in the caller's workspace role.",
        }),
      })
      .openapi({
        description:
          "What the caller may do in this project, evaluated like the routes do (task, label and project permissions from the effective access; member and invitation permissions from the effective project statements; integrations from the workspace role). The API key scope is intersected.",
      }),
  })
  .openapi("ProjectAccess");
