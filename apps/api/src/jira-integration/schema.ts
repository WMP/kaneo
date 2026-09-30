import { z } from "../openapi";
import { JIRA_DEPLOYMENTS } from "./config";

export const workspaceIdParam = z.object({ workspaceId: z.string().min(1) });
export const projectIdParam = z.object({ projectId: z.string().min(1) });

const shortText = z.string().trim().min(1).max(500);

export const jiraFieldTypeSchema = z
  .enum([
    "string",
    "text",
    "number",
    "date",
    "datetime",
    "option",
    "options",
    "labels",
    "components",
    "priority",
    "user",
    "users",
  ])
  .openapi("JiraFieldType");

export const jiraBuiltinFieldSchema = z.enum([
  "title",
  "description",
  "priority",
  "status",
  "dueDate",
  "startDate",
  "labels",
  "assignee",
  "progress",
]);

export const jiraFieldSourceSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("builtin"), field: jiraBuiltinFieldSchema }),
    z.object({ kind: z.literal("custom"), customFieldId: shortText }),
    z.object({ kind: z.literal("none") }),
  ])
  .openapi("JiraFieldSource");

const defaultValueSchema = z
  .union([
    z.string().max(5000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(500)).max(100),
  ])
  .nullable();

export const jiraFieldMappingSchema = z
  .object({
    target: z.object({
      fieldId: shortText,
      fieldName: z.string().trim().max(500).optional(),
      type: jiraFieldTypeSchema,
    }),
    source: jiraFieldSourceSchema,
    valueMap: z.record(z.string().max(500), z.string().max(500)).optional(),
    defaultValue: defaultValueSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
  .openapi("JiraFieldMapping");

export const jiraStatusMappingSchema = z
  .object({
    jiraStatusId: z.string().trim().min(1).max(100).optional(),
    jiraStatusName: shortText,
    kaneoStatus: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .openapi("JiraStatusMapping");

export const jiraUserMappingSchema = z
  .object({
    kaneoUserId: shortText,
    jiraUser: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .openapi("JiraUserMapping");

export const jiraLabelComponentMappingSchema = z
  .object({
    kaneoLabel: shortText,
    jiraComponent: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .openapi("JiraLabelComponentMapping");

// The same shape at every level (workspace, project, user); every key is
// optional and an absent key inherits from the level above.
export const jiraMappingConfigSchema = z
  .object({
    jiraProjectKey: z.string().trim().min(1).max(100).nullable().optional(),
    issueTypeId: z.string().trim().min(1).max(100).nullable().optional(),
    issueTypeName: z.string().trim().max(500).nullable().optional(),
    components: z.array(shortText).max(100).nullable().optional(),
    fieldMappings: z.array(jiraFieldMappingSchema).max(100).optional(),
    statusMappings: z.array(jiraStatusMappingSchema).max(200).optional(),
    userMappings: z.array(jiraUserMappingSchema).max(1000).optional(),
    labelComponentMappings: z
      .array(jiraLabelComponentMappingSchema)
      .max(200)
      .optional(),
  })
  .strict()
  .openapi("JiraMappingConfig");

export type JiraMappingConfig = z.infer<typeof jiraMappingConfigSchema>;
export type JiraFieldMapping = z.infer<typeof jiraFieldMappingSchema>;
export type JiraFieldType = z.infer<typeof jiraFieldTypeSchema>;
export type JiraFieldSource = z.infer<typeof jiraFieldSourceSchema>;
export type JiraStatusMapping = z.infer<typeof jiraStatusMappingSchema>;
export type JiraUserMapping = z.infer<typeof jiraUserMappingSchema>;

export const putMappingBody = z.object({ config: jiraMappingConfigSchema });

export const putConnectionBody = z
  .object({
    baseUrl: z.string().trim().min(1).max(2000),
    deployment: z.enum(JIRA_DEPLOYMENTS),
    isActive: z.boolean().optional(),
    pollingEnabled: z.boolean().optional(),
  })
  .openapi("PutJiraConnection");

export const putTokenBody = z
  .object({
    token: z.string().trim().min(1).max(4000).openapi({
      description:
        "Personal access token (Server / Data Center) or API token (Cloud). Verified against /rest/api/2/myself, stored encrypted and never returned.",
    }),
    email: z.string().trim().email().max(320).optional().openapi({
      description: "Atlassian account email. Required for Jira Cloud.",
    }),
  })
  .openapi("PutJiraToken");

export const metaFieldsQuery = z.object({
  projectKey: z.string().trim().min(1).max(100),
  issueTypeId: z.string().trim().min(1).max(100),
});

export const metaProjectKeyQuery = z.object({
  projectKey: z.string().trim().min(1).max(100),
});

export const metaUsersQuery = z.object({
  query: z.string().trim().max(200).default(""),
  projectKey: z.string().trim().min(1).max(100).optional(),
});
