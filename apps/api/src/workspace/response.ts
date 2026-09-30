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
    memberId: z.string().openapi({
      description:
        "The id of the membership row (Better Auth member id), as update-member-role expects it. `id` is the user id.",
    }),
    joinedAt: responseTimestamp,
    fullAccess: z.boolean().optional().openapi({
      description:
        "Only with include=projects, for a caller who manages members: true when the person reaches every project of the workspace through their workspace role (owner, instance administrator, or a role granting workspace:manage_settings).",
    }),
    projects: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          role: z.string().openapi({ description: "The project role." }),
        }),
      )
      .optional()
      .openapi({
        description:
          "Only with include=projects, for a caller who manages members: the projects the person is a member of with their project role, limited to the projects the caller can open. Empty for a full-access person.",
      }),
  })
  .openapi("WorkspaceMember");

export const workspaceMemberListSchema = z.array(workspaceMemberSchema);

export const addedWorkspaceMemberSchema = workspaceMemberSchema
  .omit({ fullAccess: true, projects: true })
  .extend({
    emailAttempted: z.boolean().openapi({
      description:
        "False when nothing was sent because SMTP is not configured on this instance.",
    }),
    emailSent: z.boolean().openapi({
      description:
        "True when the email 'you were added to the workspace' was handed to the mail server. A failing relay is logged and never fails the request.",
    }),
  })
  .openapi("AddedWorkspaceMember");

export const userDirectoryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .openapi("UserDirectoryEntry");

export const userDirectoryListSchema = z.array(userDirectoryEntrySchema);

export const assignableRolesSchema = z
  .object({
    roles: z.array(
      z.object({
        role: z.string().openapi({
          description:
            "Role name to pass when inviting a member or changing a role.",
        }),
        isDefault: z.boolean().openapi({
          description:
            "True for the built-in viewer, member and admin roles; false for custom roles.",
        }),
      }),
    ),
  })
  .openapi("AssignableRoles", {
    description:
      "Roles the caller may grant through invitations or role changes: those whose permissions the caller also holds. Never includes owner.",
  });

const activityTypeDescription =
  "One of: comment, created, moved, status_changed, priority_changed, assignee_changed, unassigned, due_date_changed, title_changed, description_changed, approval_changed, updated, relation_created, relation_updated, relation_deleted.";

export const workspaceActivitySchema = z
  .object({
    id: z.string(),
    taskId: z.string().nullable().openapi({
      description:
        "Null for workspace-level activity (e.g. calendar changes), which has no task.",
    }),
    taskNumber: z.number().nullable().openapi({
      description: "The task's per-project short number, e.g. 42 in DEP-42.",
    }),
    taskTitle: z.string().nullable(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    projectSlug: z.string().nullable(),
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

export const workspaceActivityExportSchema = z
  .object({
    data: z.array(workspaceActivitySchema),
    truncated: z.boolean().openapi({
      description:
        "True when more matching activity exists than the export row cap; narrow the filters to export the rest.",
    }),
  })
  .openapi("WorkspaceActivityExport");

export const workspaceActivityRetentionSchema = z
  .object({
    activityRetentionDays: z.number().int().positive().nullable().openapi({
      description:
        "Days of activity history to keep, or null when retention is disabled (keep forever, the default).",
    }),
  })
  .openapi("WorkspaceActivityRetention");
