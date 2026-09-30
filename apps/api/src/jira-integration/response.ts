import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { JIRA_DEPLOYMENTS } from "./config";
import {
  jiraFieldMappingSchema,
  jiraFieldTypeSchema,
  jiraMappingConfigSchema,
} from "./schema";

const originSchema = z
  .enum(["default", "workspace", "project", "user"])
  .openapi("JiraMappingOrigin");

function resolved<T extends z.ZodType>(value: T) {
  return z.object({ value, origin: originSchema });
}

export const jiraConnectionSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    baseUrl: z.string(),
    deployment: z.enum(JIRA_DEPLOYMENTS),
    isActive: z.boolean(),
    pollingEnabled: z.boolean(),
    webhookUrl: z.string().optional().openapi({
      description:
        "Where Jira should POST issue events. Only returned to callers with workspace:manage_settings.",
    }),
    webhookSecret: z.string().optional().openapi({
      description:
        "Secret carried in the webhook URL. Only returned to callers with workspace:manage_settings.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("JiraConnection");

export const jiraDeleteResultSchema = z
  .object({ success: z.boolean() })
  .openapi("JiraDeleteResult");

export const jiraTokenStatusSchema = z
  .object({
    connected: z.boolean(),
    jiraAccountId: z.string().nullable(),
    jiraUsername: z.string().nullable(),
    jiraDisplayName: z.string().nullable(),
    email: z.string().nullable(),
    lastVerifiedAt: nullableResponseTimestamp,
    lastError: z.string().nullable(),
  })
  .openapi("JiraTokenStatus", {
    description:
      "The Jira identity of the caller's token. The token itself is never returned.",
  });

export const resolvedJiraMappingSchema = z
  .object({
    jiraProjectKey: resolved(z.string().nullable()),
    issueTypeId: resolved(z.string().nullable()),
    issueTypeName: resolved(z.string().nullable()),
    components: resolved(z.array(z.string())),
    fieldMappings: z.array(
      jiraFieldMappingSchema
        .omit({ disabled: true })
        .extend({ origin: originSchema }),
    ),
    statusMappings: z.array(
      z.object({
        jiraStatusId: z.string().optional(),
        jiraStatusName: z.string(),
        kaneoStatus: z.string(),
        origin: originSchema,
      }),
    ),
    userMappings: z.array(
      z.object({
        kaneoUserId: z.string(),
        jiraUser: z.string(),
        origin: originSchema,
      }),
    ),
    labelComponentMappings: z.array(
      z.object({
        kaneoLabel: z.string(),
        jiraComponent: z.string(),
        origin: originSchema,
      }),
    ),
  })
  .openapi("ResolvedJiraMapping");

export const jiraMappingLevelSchema = z
  .object({
    config: jiraMappingConfigSchema,
    parent: resolvedJiraMappingSchema.openapi({
      description:
        "The levels above this one merged (default, workspace, and for a user also the workspace), with the origin of every value.",
    }),
    updatedAt: nullableResponseTimestamp,
  })
  .openapi("JiraMappingLevel");

export const jiraResolvedMappingResponseSchema = z
  .object({ mapping: resolvedJiraMappingSchema })
  .openapi("JiraResolvedMapping");

export const jiraMetaProjectListSchema = z
  .object({
    projects: z.array(
      z.object({ id: z.string(), key: z.string(), name: z.string() }),
    ),
  })
  .openapi("JiraMetaProjectList");

export const jiraMetaIssueTypeListSchema = z
  .object({
    issueTypes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        subtask: z.boolean().optional(),
      }),
    ),
  })
  .openapi("JiraMetaIssueTypeList");

export const jiraMetaFieldListSchema = z
  .object({
    fields: z.array(
      z.object({
        fieldId: z.string(),
        name: z.string(),
        required: z.boolean(),
        hasDefaultValue: z.boolean(),
        schema: z
          .object({
            type: z.string(),
            items: z.string().optional(),
            system: z.string().optional(),
            custom: z.string().optional(),
          })
          .nullable(),
        allowedValues: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().optional(),
              value: z.string().optional(),
            }),
          )
          .nullable(),
      }),
    ),
  })
  .openapi("JiraMetaFieldList");

export const jiraMetaStatusListSchema = z
  .object({
    statuses: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string().nullable(),
      }),
    ),
  })
  .openapi("JiraMetaStatusList");

export const jiraMetaComponentListSchema = z
  .object({
    components: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .openapi("JiraMetaComponentList");

export const jiraMetaUserListSchema = z
  .object({
    users: z.array(
      z.object({
        name: z.string().nullable(),
        accountId: z.string().nullable(),
        displayName: z.string().nullable(),
        emailAddress: z.string().nullable(),
      }),
    ),
  })
  .openapi("JiraMetaUserList");

export const jiraErrorSchema = z
  .object({
    code: z.string().openapi({
      description:
        "JIRA_NOT_CONFIGURED, JIRA_TOKEN_MISSING, JIRA_TOKEN_INVALID, JIRA_ENCRYPTION_KEY_MISSING, JIRA_REQUEST_FAILED, JIRA_ISSUE_ALREADY_LINKED, JIRA_NOT_LINKED, PROPOSAL_NOT_PENDING or STATUS_REQUIRED.",
    }),
    message: z.string(),
    jiraStatus: z.number().optional().openapi({
      description: "HTTP status Jira answered with, for JIRA_REQUEST_FAILED.",
    }),
    errorMessages: z.array(z.string()).optional(),
    errors: z.record(z.string(), z.string()).optional(),
  })
  .openapi("JiraError");

// The access middleware answers plain text; Jira failures answer this JSON.
export function jiraErrorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: jiraErrorSchema },
      "text/plain": { schema: z.string() },
    },
  };
}

export const jiraIssueLinkSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    issueId: z.string(),
    issueKey: z.string(),
    issueUrl: z.string(),
    jiraProjectKey: z.string(),
    lastStatusId: z.string().nullable(),
    lastStatusName: z.string().nullable(),
    lastSyncedAt: nullableResponseTimestamp,
    syncError: z.string().nullable(),
    createdByUserId: z.string().nullable().openapi({
      description:
        "Whose Jira token the poll uses to read this issue. Null when that person was deleted.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("JiraIssueLink");

export const jiraStatusProposalSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    linkId: z.string(),
    fromStatusName: z.string().nullable(),
    toStatusId: z.string().nullable(),
    toStatusName: z.string(),
    proposedStatus: z.string().nullable().openapi({
      description:
        "The Kaneo status the Jira status maps to. Null when it is not mapped: whoever accepts chooses one.",
    }),
    state: z.enum(["pending", "accepted", "rejected", "superseded"]),
    jiraChangedBy: z.string().nullable(),
    jiraChangedAt: nullableResponseTimestamp,
    source: z.enum(["webhook", "poll", "manual"]),
    resolvedByUserId: z.string().nullable(),
    resolvedStatus: z.string().nullable(),
    resolvedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
  })
  .openapi("JiraStatusProposal", {
    description:
      "A status change seen in Jira. The task's status only changes when a person with task:update accepts it.",
  });

const jiraSyncHintSchema = z
  .object({
    pollingEnabled: z.boolean(),
    creatorTokenState: z.enum(["ok", "missing", "invalid"]).openapi({
      description:
        "State of the token of the person who linked the issue, which the poll uses. Missing or invalid: the poll skips this link.",
    }),
  })
  .openapi("JiraSyncHint");

export const jiraTaskInfoSchema = z
  .object({
    link: jiraIssueLinkSchema.nullable(),
    pendingProposal: jiraStatusProposalSchema.nullable(),
    proposals: z.array(jiraStatusProposalSchema).openapi({
      description: "The 10 most recent proposals, newest first.",
    }),
    sync: jiraSyncHintSchema.nullable(),
  })
  .openapi("JiraTaskInfo");

export const jiraRefreshResultSchema = z
  .object({
    changed: z.boolean().openapi({
      description:
        "True when the read found a status the task's link did not know yet.",
    }),
    info: jiraTaskInfoSchema,
  })
  .openapi("JiraRefreshResult");

const jiraWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const draftValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
  .nullable();

export const jiraDraftFieldSchema = z
  .object({
    fieldId: z.string(),
    fieldName: z.string(),
    type: jiraFieldTypeSchema,
    value: draftValueSchema.openapi({
      description:
        "The editable Kaneo-side value, before the mapping's value map is applied.",
    }),
    jiraValue: z.unknown().openapi({
      description:
        "What would be sent to Jira for `value`, or null when nothing is sent.",
    }),
    origin: z.enum(["task", "default", "empty"]).openapi({
      description:
        "task: the task's own value; default: the mapping's default value; empty: nothing to send.",
    }),
    mappingOrigin: originSchema,
    required: z.boolean().optional(),
    allowedValues: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          value: z.string().optional(),
        }),
      )
      .nullable()
      .optional(),
  })
  .openapi("JiraDraftField");

export const jiraDraftSchema = z
  .object({
    taskId: z.string(),
    connection: z.object({
      id: z.string(),
      baseUrl: z.string(),
      deployment: z.enum(JIRA_DEPLOYMENTS),
    }),
    tokenConnected: z.boolean(),
    target: z.object({
      jiraProjectKey: resolved(z.string().nullable()),
      issueTypeId: resolved(z.string().nullable()),
      issueTypeName: resolved(z.string().nullable()),
    }),
    link: jiraIssueLinkSchema.nullable(),
    fields: z.array(jiraDraftFieldSchema),
    missingRequired: z.array(
      z.object({
        fieldId: z.string(),
        name: z.string(),
        mapped: z.boolean(),
      }),
    ),
    warnings: z.array(jiraWarningSchema),
    createMeta: z
      .object({ jiraProjectKey: z.string(), issueTypeId: z.string() })
      .nullable()
      .openapi({
        description:
          "The Jira project and issue type the required flags and allowed values were read for, or null when they could not be read.",
      }),
  })
  .openapi("JiraDraft");

export const jiraSendResultSchema = z
  .object({
    created: z.boolean().openapi({
      description: "True when a new issue was created, false for an update.",
    }),
    link: jiraIssueLinkSchema,
    warnings: z.array(jiraWarningSchema),
  })
  .openapi("JiraSendResult");

export const jiraProposalResultSchema = z
  .object({ proposal: jiraStatusProposalSchema })
  .openapi("JiraProposalResult");
