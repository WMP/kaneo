import { responseTimestamp, z } from "../openapi";

export const workspaceMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().openapi({
      description:
        "The member's workspace role: a built-in role (owner, admin, member, guest) or a custom role name.",
    }),
  })
  .openapi("WorkspaceMember");

export const workspaceMemberListSchema = z.array(workspaceMemberSchema);

const activityTypeDescription =
  "One of: comment, task, create, created, moved, status_changed, priority_changed, assignee_changed, unassigned, due_date_changed, title_changed, description_changed.";

export const workspaceActivitySchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    taskNumber: z.number().nullable().openapi({
      description: "The task's per-project short number, e.g. 42 in DEP-42.",
    }),
    taskTitle: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    projectSlug: z.string(),
    type: z.string().openapi({ description: activityTypeDescription }),
    createdAt: responseTimestamp,
    userId: z.string().nullable(),
    userName: z.string().nullable().openapi({
      description: "Null when the user account no longer exists.",
    }),
    userImage: z.string().nullable(),
    content: z.string().nullable(),
    eventData: z.unknown().openapi({
      description:
        "Type-specific payload, e.g. { oldStatus, newStatus } for status_changed. Null for plain comments.",
    }),
    externalUserName: z.string().nullable().openapi({
      description: "Set when the activity was imported from another tool.",
    }),
    externalUserAvatar: z.string().nullable(),
    externalSource: z.string().nullable().openapi({
      description: "The tool it was imported from, e.g. planka, trello, jira.",
    }),
    externalUrl: z.string().nullable(),
  })
  .openapi("WorkspaceActivity");

export const workspaceActivityListSchema = z
  .object({
    data: z.array(workspaceActivitySchema),
    pagination: z
      .object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        totalPages: z.number(),
      })
      .openapi("WorkspaceActivityPagination"),
  })
  .openapi("WorkspaceActivityList");
