import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { JIRA_DEPLOYMENTS } from "./config";
import { jiraFieldMappingSchema, jiraMappingConfigSchema } from "./schema";

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
        "JIRA_NOT_CONFIGURED, JIRA_TOKEN_MISSING, JIRA_TOKEN_INVALID, JIRA_ENCRYPTION_KEY_MISSING or JIRA_REQUEST_FAILED.",
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
