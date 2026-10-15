import { responseTimestamp, z } from "../openapi";

const activityTypeDescription =
  "One of: comment, created, moved, status_changed, priority_changed, assignee_changed, unassigned, due_date_changed, title_changed, description_changed, approval_changed, updated, relation_created, relation_updated, relation_deleted, jira_issue_created, jira_issue_updated, jira_issue_unlinked, jira_status_changed.";

export const activitySchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    type: z.string().openapi({ description: activityTypeDescription }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    userId: z.string().nullable(),
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
      description:
        "The tool it was imported from: planka, trello, jira, plane, linear, kaneo, or a connected forge such as github.",
    }),
    externalUrl: z.string().nullable(),
    actorVia: z.enum(["mcp", "api"]).nullable().openapi({
      description:
        "How the user made this change when not through the web UI: mcp (an MCP client session) or api (an API key). Null for the web UI, imports and older activity.",
    }),
    actorTokenHint: z.string().nullable().openapi({
      description:
        "Short, non-secret hint of the token used: the beginning of the API key (as shown in the key settings) or the last characters of the MCP session token. Never the full token. Null when actorVia is null.",
    }),
  })
  .openapi("Activity");

export const activityListSchema = z.array(activitySchema);

export const workspaceActivityListSchema = z.array(
  z
    .object({
      id: z.string(),
      type: z.string().openapi({ description: activityTypeDescription }),
      createdAt: responseTimestamp,
      eventData: z.unknown().openapi({
        description:
          "Type-specific payload. For status_changed, oldStatus/newStatus are slugs and oldStatusName/newStatusName carry current configured column names when available.",
      }),
      excerpt: z.string().nullable().openapi({
        description:
          "Plain-text preview of the stored content, at most 240 characters: the comment body, or the description older system events carry instead of eventData.",
      }),
      userId: z.string().nullable(),
      userName: z.string().nullable(),
      userImage: z.string().nullable(),
      externalUserName: z.string().nullable(),
      externalUserAvatar: z.string().nullable(),
      taskId: z.string(),
      taskTitle: z.string(),
      taskNumber: z.number().nullable(),
      projectId: z.string(),
      projectSlug: z.string(),
    })
    .openapi("WorkspaceActivity"),
);
