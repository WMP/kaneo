import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { proposalAccess, requireTaskInWorkspace } from "./access";
import {
  deleteJiraConnection,
  rotateJiraWebhookSecret,
  toConnectionResponse,
  upsertJiraConnection,
} from "./connection";
import { buildTaskDraft } from "./draft-loader";
import { jiraError, withJiraErrors } from "./errors";
import { createJiraClient } from "./jira-client";
import { toLinkResponse, toProposalResponse } from "./links";
import {
  loadMapping,
  type MappingKey,
  resolveMappingForUser,
  resolveParent,
  saveMapping,
  validateMappingReferences,
} from "./mapping-store";
import {
  shapeComponents,
  shapeFields,
  shapeIssueTypes,
  shapeProjects,
  shapeStatuses,
  shapeUsers,
} from "./meta";
import { acceptProposal, rejectProposal } from "./proposals";
import {
  jiraConnectionSchema,
  jiraDeleteResultSchema,
  jiraDraftSchema,
  jiraErrorResponse,
  jiraMappingLevelSchema,
  jiraMetaComponentListSchema,
  jiraMetaFieldListSchema,
  jiraMetaIssueTypeListSchema,
  jiraMetaProjectListSchema,
  jiraMetaStatusListSchema,
  jiraMetaUserListSchema,
  jiraProposalResultSchema,
  jiraRefreshResultSchema,
  jiraResolvedMappingResponseSchema,
  jiraSendResultSchema,
  jiraTaskInfoSchema,
  jiraTokenStatusSchema,
} from "./response";
import {
  acceptProposalBody,
  draftQuery,
  metaFieldsQuery,
  metaProjectKeyQuery,
  metaUsersQuery,
  projectIdParam,
  proposalIdParam,
  putConnectionBody,
  putMappingBody,
  putTokenBody,
  sendBody,
  taskIdParam,
  workspaceIdParam,
} from "./schema";
import { sendTaskToJira } from "./send";
import { loadTaskInfo, refreshTaskStatus, unlinkTask } from "./task-link";
import {
  assertJiraEncryptionKey,
  deleteJiraUserToken,
  findJiraConnection,
  findJiraUserToken,
  getJiraClientForUser,
  requireActiveJiraConnection,
  requireJiraConnection,
  storeJiraUserToken,
  toTokenStatus,
} from "./tokens";

const memberAccess = [workspaceAccess.fromParam("workspaceId")];

const manageAccess = [
  workspaceAccess.fromParam("workspaceId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
];

const projectReadAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["read"] }),
];

const projectWriteAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["update"] }),
];

const taskReadAccess = [
  workspaceAccess.fromTaskId(),
  requireWorkspacePermission({ task: ["read"] }),
];

const taskUpdateAccess = [
  workspaceAccess.fromTaskId(),
  requireWorkspacePermission({ task: ["update"] }),
];

const proposalUpdateAccess = [
  proposalAccess,
  requireWorkspacePermission({ task: ["update"] }),
];

const NO_WORKSPACE_ACCESS = "No access to the workspace";
const NO_MANAGE_SETTINGS =
  "No workspace access, or missing workspace:manage_settings";

const getConnectionRoute = createRoute({
  method: "get",
  operationId: "getJiraConnection",
  path: "/workspace/{workspaceId}/connection",
  tags: ["Jira"],
  summary: "Get the Jira connection",
  description:
    "Get the workspace's Jira connection, or null when none is configured. Every workspace member gets the base URL, deployment and flags; the webhook URL and secret are only returned to callers with workspace:manage_settings.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The connection, or null",
      jiraConnectionSchema.nullable(),
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const putConnectionRoute = createRoute({
  method: "put",
  operationId: "putJiraConnection",
  path: "/workspace/{workspaceId}/connection",
  tags: ["Jira"],
  summary: "Create or update the Jira connection",
  description:
    "Create or update the workspace's Jira connection. The base URL is normalized and must use https unless KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS is enabled. A webhook secret is generated on create. Changing the base URL or the deployment removes every stored user token, so a credential is never sent to an address it was not given for.",
  middleware: manageAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putConnectionBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored connection", jiraConnectionSchema),
    400: errorResponse("Invalid body or base URL"),
    403: errorResponse(NO_MANAGE_SETTINGS),
  },
});

const rotateSecretRoute = createRoute({
  method: "post",
  operationId: "rotateJiraWebhookSecret",
  path: "/workspace/{workspaceId}/connection/rotate-webhook-secret",
  tags: ["Jira"],
  summary: "Rotate the Jira webhook secret",
  description:
    "Generate a new webhook secret. The previous webhook URL stops working; update the webhook in Jira.",
  middleware: manageAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The connection with its new secret",
      jiraConnectionSchema,
    ),
    403: errorResponse(NO_MANAGE_SETTINGS),
    404: jiraErrorResponse("The workspace has no Jira connection"),
  },
});

const deleteConnectionRoute = createRoute({
  method: "delete",
  operationId: "deleteJiraConnection",
  path: "/workspace/{workspaceId}/connection",
  tags: ["Jira"],
  summary: "Delete the Jira connection",
  description:
    "Remove the connection together with every user token, issue link and status proposal. Mappings are kept.",
  middleware: manageAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The connection was removed", jiraDeleteResultSchema),
    403: errorResponse(NO_MANAGE_SETTINGS),
    404: jiraErrorResponse("The workspace has no Jira connection"),
  },
});

const getWorkspaceMappingRoute = createRoute({
  method: "get",
  operationId: "getJiraWorkspaceMapping",
  path: "/workspace/{workspaceId}/mapping",
  tags: ["Jira"],
  summary: "Get the workspace Jira mapping",
  description:
    "Get the workspace-level mapping of Kaneo fields to Jira fields, with the built-in defaults it inherits from.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The workspace mapping", jiraMappingLevelSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const putWorkspaceMappingRoute = createRoute({
  method: "put",
  operationId: "putJiraWorkspaceMapping",
  path: "/workspace/{workspaceId}/mapping",
  tags: ["Jira"],
  summary: "Set the workspace Jira mapping",
  description:
    "Replace the workspace-level mapping. Custom fields must belong to the workspace.",
  middleware: manageAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putMappingBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored mapping", jiraMappingLevelSchema),
    400: errorResponse("Invalid mapping, or an unknown custom field"),
    403: errorResponse(NO_MANAGE_SETTINGS),
  },
});

const getProjectMappingRoute = createRoute({
  method: "get",
  operationId: "getJiraProjectMapping",
  path: "/project/{projectId}/mapping",
  tags: ["Jira"],
  summary: "Get the project Jira mapping",
  description:
    "Get the project-level mapping and, as `parent`, the default and workspace levels merged with the origin of every value.",
  middleware: projectReadAccess,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The project mapping", jiraMappingLevelSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project, or missing project:read"),
  },
});

const putProjectMappingRoute = createRoute({
  method: "put",
  operationId: "putJiraProjectMapping",
  path: "/project/{projectId}/mapping",
  tags: ["Jira"],
  summary: "Set the project Jira mapping",
  description:
    "Replace the project-level mapping. Custom fields must be effective fields of the project and mapped Kaneo statuses must be statuses of the project.",
  middleware: projectWriteAccess,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putMappingBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored mapping", jiraMappingLevelSchema),
    400: errorResponse(
      "Invalid mapping, an unknown custom field or an invalid status",
    ),
    403: errorResponse("No access to the project, or missing project:update"),
  },
});

const getResolvedMappingRoute = createRoute({
  method: "get",
  operationId: "getJiraResolvedMapping",
  path: "/project/{projectId}/resolved-mapping",
  tags: ["Jira"],
  summary: "Get the resolved Jira mapping",
  description:
    "The mapping that applies to the caller's sends from this project: default, workspace, project and the caller's own level merged, every value with its origin. Status mappings ignore the user level.",
  middleware: projectReadAccess,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "The resolved mapping",
      jiraResolvedMappingResponseSchema,
    ),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project, or missing project:read"),
  },
});

const getTokenRoute = createRoute({
  method: "get",
  operationId: "getJiraTokenStatus",
  path: "/workspace/{workspaceId}/me/token",
  tags: ["Jira"],
  summary: "Get the caller's Jira token status",
  description:
    "Whether the caller has a Jira token in this workspace and which Jira identity it belongs to. The token is never returned.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The caller's token status", jiraTokenStatusSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const putTokenRoute = createRoute({
  method: "put",
  operationId: "putJiraToken",
  path: "/workspace/{workspaceId}/me/token",
  tags: ["Jira"],
  summary: "Set the caller's Jira token",
  description:
    "Verify the token against /rest/api/2/myself and store it encrypted for the caller. Jira Cloud also needs the Atlassian email. Answers 503 JIRA_ENCRYPTION_KEY_MISSING when the server has no NOTIFICATION_SECRET_ENCRYPTION_KEY; the token is never stored in plaintext.",
  middleware: memberAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putTokenBody } },
    },
  },
  responses: {
    200: jsonResponse("The verified token's status", jiraTokenStatusSchema),
    400: errorResponse("Invalid body, or the email is missing for Jira Cloud"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
    404: jiraErrorResponse("The workspace has no Jira connection"),
    422: jiraErrorResponse("Jira rejected the token"),
    502: jiraErrorResponse("Jira could not be reached or failed"),
    503: jiraErrorResponse("The server has no token encryption key"),
  },
});

const deleteTokenRoute = createRoute({
  method: "delete",
  operationId: "deleteJiraToken",
  path: "/workspace/{workspaceId}/me/token",
  tags: ["Jira"],
  summary: "Delete the caller's Jira token",
  description:
    "Remove the caller's own token. Other people's tokens are not reachable.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The token was removed", jiraDeleteResultSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const getUserMappingRoute = createRoute({
  method: "get",
  operationId: "getJiraUserMapping",
  path: "/workspace/{workspaceId}/me/mapping",
  tags: ["Jira"],
  summary: "Get the caller's Jira mapping",
  description:
    "The caller's user-level mapping, applied to their own sends in this workspace, with the default and workspace levels as `parent`.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The caller's mapping", jiraMappingLevelSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const putUserMappingRoute = createRoute({
  method: "put",
  operationId: "putJiraUserMapping",
  path: "/workspace/{workspaceId}/me/mapping",
  tags: ["Jira"],
  summary: "Set the caller's Jira mapping",
  description:
    "Replace the caller's user-level mapping. Status mappings are rejected at this level: a status proposal belongs to the task, not to a person.",
  middleware: memberAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putMappingBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored mapping", jiraMappingLevelSchema),
    400: errorResponse(
      "Invalid mapping, status mappings, or an unknown custom field",
    ),
    403: errorResponse(NO_WORKSPACE_ACCESS),
  },
});

const metaErrors = {
  400: errorResponse("Invalid query, or Jira URL not allowed"),
  403: errorResponse(NO_WORKSPACE_ACCESS),
  404: jiraErrorResponse("No (active) Jira connection in this workspace"),
  409: jiraErrorResponse("The caller has no Jira token"),
  422: jiraErrorResponse("Jira rejected the caller's token"),
  502: jiraErrorResponse("Jira could not be reached or failed"),
  503: jiraErrorResponse("The server has no token encryption key"),
} as const;

const metaProjectsRoute = createRoute({
  method: "get",
  operationId: "listJiraProjects",
  path: "/workspace/{workspaceId}/meta/projects",
  tags: ["Jira"],
  summary: "List Jira projects",
  description: "Jira projects visible to the caller's own token, for pickers.",
  middleware: memberAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Jira projects", jiraMetaProjectListSchema),
    ...metaErrors,
  },
});

const metaIssueTypesRoute = createRoute({
  method: "get",
  operationId: "listJiraIssueTypes",
  path: "/workspace/{workspaceId}/meta/issue-types",
  tags: ["Jira"],
  summary: "List Jira issue types",
  description: "Issue types of a Jira project, read with the caller's token.",
  middleware: memberAccess,
  request: { params: workspaceIdParam, query: metaProjectKeyQuery },
  responses: {
    200: jsonResponse("Issue types", jiraMetaIssueTypeListSchema),
    ...metaErrors,
  },
});

const metaFieldsRoute = createRoute({
  method: "get",
  operationId: "listJiraCreateFields",
  path: "/workspace/{workspaceId}/meta/fields",
  tags: ["Jira"],
  summary: "List Jira create fields",
  description:
    "Fields Jira offers when creating an issue of this type in this project, with required flags and allowed values.",
  middleware: memberAccess,
  request: { params: workspaceIdParam, query: metaFieldsQuery },
  responses: {
    200: jsonResponse("Create fields", jiraMetaFieldListSchema),
    ...metaErrors,
  },
});

const metaStatusesRoute = createRoute({
  method: "get",
  operationId: "listJiraStatuses",
  path: "/workspace/{workspaceId}/meta/statuses",
  tags: ["Jira"],
  summary: "List Jira statuses",
  description:
    "Statuses used by a Jira project, each listed once across its issue types.",
  middleware: memberAccess,
  request: { params: workspaceIdParam, query: metaProjectKeyQuery },
  responses: {
    200: jsonResponse("Statuses", jiraMetaStatusListSchema),
    ...metaErrors,
  },
});

const metaComponentsRoute = createRoute({
  method: "get",
  operationId: "listJiraComponents",
  path: "/workspace/{workspaceId}/meta/components",
  tags: ["Jira"],
  summary: "List Jira components",
  description: "Components of a Jira project, read with the caller's token.",
  middleware: memberAccess,
  request: { params: workspaceIdParam, query: metaProjectKeyQuery },
  responses: {
    200: jsonResponse("Components", jiraMetaComponentListSchema),
    ...metaErrors,
  },
});

const metaUsersRoute = createRoute({
  method: "get",
  operationId: "searchJiraUsers",
  path: "/workspace/{workspaceId}/meta/users",
  tags: ["Jira"],
  summary: "Search Jira users",
  description:
    "Search Jira users, or the users assignable in a project when projectKey is given, with the caller's token.",
  middleware: memberAccess,
  request: { params: workspaceIdParam, query: metaUsersQuery },
  responses: {
    200: jsonResponse("Jira users", jiraMetaUserListSchema),
    ...metaErrors,
  },
});

const NO_TASK_ACCESS =
  "No access to the task's project, or missing task permission";

const taskErrors = {
  403: errorResponse(NO_TASK_ACCESS),
  404: jiraErrorResponse("Unknown task"),
} as const;

const jiraCallErrors = {
  404: jiraErrorResponse("Unknown task, or no (active) Jira connection"),
  409: jiraErrorResponse("The caller has no Jira token"),
  422: jiraErrorResponse("Jira rejected the caller's token"),
  502: jiraErrorResponse("Jira could not be reached or failed"),
  503: jiraErrorResponse("The server has no token encryption key"),
} as const;

const getTaskInfoRoute = createRoute({
  method: "get",
  operationId: "getJiraTaskInfo",
  path: "/task/{taskId}",
  tags: ["Jira"],
  summary: "Get the Jira state of a task",
  description:
    "The Jira issue the task is linked to, its pending status proposal and the 10 most recent proposals. Answers with no link when the workspace has no Jira connection.",
  middleware: taskReadAccess,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The task's Jira state", jiraTaskInfoSchema),
    400: errorResponse("Workspace ID could not be determined"),
    ...taskErrors,
  },
});

const getDraftRoute = createRoute({
  method: "get",
  operationId: "getJiraDraft",
  path: "/task/{taskId}/draft",
  tags: ["Jira"],
  summary: "Preview what would be sent to Jira",
  description:
    "Every mapped field with its value, where the value comes from (the task, the mapping's default, or nothing) and, when Jira's create metadata can be read with the caller's own token, which fields are required and what they allow. A Jira failure is a warning, not an error. The mapping is resolved for the caller: default, workspace, project and the caller's own level.",
  middleware: taskUpdateAccess,
  request: { params: taskIdParam, query: draftQuery },
  responses: {
    200: jsonResponse("The draft", jiraDraftSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(NO_TASK_ACCESS),
    404: jiraErrorResponse("Unknown task, or no (active) Jira connection"),
  },
});

const sendRoute = createRoute({
  method: "post",
  operationId: "sendTaskToJira",
  path: "/task/{taskId}/send",
  tags: ["Jira"],
  summary: "Send a task to Jira",
  description:
    "Create the Jira issue, or update the linked one (without project and issue type), with the CALLER's own Jira token. Only typed field values are accepted; they are converted to Jira's JSON on the server and empty values are left out. Stores the link and writes the activity jira_issue_created or jira_issue_updated.",
  middleware: taskUpdateAccess,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: sendBody } },
    },
  },
  responses: {
    200: jsonResponse("The issue was created or updated", jiraSendResultSchema),
    400: errorResponse(
      "Invalid body, or a value that does not fit its field type",
    ),
    403: errorResponse(NO_TASK_ACCESS),
    ...jiraCallErrors,
    409: jiraErrorResponse(
      "The caller has no Jira token (JIRA_TOKEN_MISSING), or the issue is already linked to a task (JIRA_ISSUE_ALREADY_LINKED)",
    ),
  },
});

const refreshRoute = createRoute({
  method: "post",
  operationId: "refreshJiraTask",
  path: "/task/{taskId}/refresh",
  tags: ["Jira"],
  summary: "Read the Jira status now",
  description:
    "Read the linked issue's status with the caller's own token and process a change like the webhook and the poll do: activity, and a status proposal. The task's status is never changed.",
  middleware: taskReadAccess,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "The task's Jira state after the read",
      jiraRefreshResultSchema,
    ),
    403: errorResponse(NO_TASK_ACCESS),
    404: jiraErrorResponse(
      "Unknown task, task not linked (JIRA_NOT_LINKED), or no (active) Jira connection",
    ),
    409: jiraErrorResponse("The caller has no Jira token"),
    422: jiraErrorResponse("Jira rejected the caller's token"),
    502: jiraErrorResponse("Jira could not be reached or failed"),
    503: jiraErrorResponse("The server has no token encryption key"),
  },
});

const unlinkRoute = createRoute({
  method: "delete",
  operationId: "unlinkJiraIssue",
  path: "/task/{taskId}/link",
  tags: ["Jira"],
  summary: "Unlink the Jira issue",
  description:
    "Remove the link between the task and its Jira issue, with its proposals. The Jira issue is not touched.",
  middleware: taskUpdateAccess,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "The link was removed, or there was none",
      jiraDeleteResultSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    ...taskErrors,
  },
});

const proposalErrors = {
  403: errorResponse(NO_TASK_ACCESS),
  404: jiraErrorResponse("Unknown proposal"),
  409: jiraErrorResponse(
    "The proposal is no longer pending (PROPOSAL_NOT_PENDING)",
  ),
} as const;

const acceptProposalRoute = createRoute({
  method: "post",
  operationId: "acceptJiraStatusProposal",
  path: "/proposal/{proposalId}/accept",
  tags: ["Jira"],
  summary: "Accept a Jira status proposal",
  description:
    "Set the task's status through the normal status change (events, activity, notifications and realtime apply, attributed to the caller) and mark the proposal accepted. The status defaults to the proposal's mapped status and is required when it has none (STATUS_REQUIRED). Needs task:update in the task's project.",
  middleware: proposalUpdateAccess,
  request: {
    params: proposalIdParam,
    body: {
      required: false,
      content: { "application/json": { schema: acceptProposalBody } },
    },
  },
  responses: {
    200: jsonResponse("The accepted proposal", jiraProposalResultSchema),
    400: jiraErrorResponse(
      "No status given for an unmapped proposal (STATUS_REQUIRED), or an invalid status",
    ),
    ...proposalErrors,
  },
});

const rejectProposalRoute = createRoute({
  method: "post",
  operationId: "rejectJiraStatusProposal",
  path: "/proposal/{proposalId}/reject",
  tags: ["Jira"],
  summary: "Reject a Jira status proposal",
  description:
    "Mark the proposal rejected; the task's status stays as it is. Needs task:update in the task's project.",
  middleware: proposalUpdateAccess,
  request: { params: proposalIdParam },
  responses: {
    200: jsonResponse("The rejected proposal", jiraProposalResultSchema),
    ...proposalErrors,
  },
});

const jiraIntegration = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getConnectionRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const connection = await findJiraConnection(workspaceId);
    if (!connection) {
      return c.json(null, 200);
    }
    const includeSecrets = await hasWorkspacePermission(c, {
      workspace: ["manage_settings"],
    });
    return c.json(toConnectionResponse(connection, includeSecrets), 200);
  })
  .openapi(putConnectionRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const connection = await upsertJiraConnection({
      workspaceId,
      ...c.req.valid("json"),
    });
    return c.json(toConnectionResponse(connection, true), 200);
  })
  .openapi(rotateSecretRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const existing = await requireJiraConnection(workspaceId);
    const connection = await rotateJiraWebhookSecret(existing.id);
    return c.json(toConnectionResponse(connection, true), 200);
  })
  .openapi(deleteConnectionRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const existing = await requireJiraConnection(workspaceId);
    await deleteJiraConnection(existing.id);
    return c.json({ success: true }, 200);
  })
  .openapi(getWorkspaceMappingRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const stored = await loadMapping({ scope: "workspace", workspaceId });
    return c.json(
      {
        config: stored?.config ?? {},
        parent: await resolveParent(workspaceId, "workspace"),
        updatedAt: stored?.updatedAt ?? null,
      },
      200,
    );
  })
  .openapi(putWorkspaceMappingRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { config } = c.req.valid("json");
    const key: MappingKey = { scope: "workspace", workspaceId };
    await validateMappingReferences(key, config);
    const stored = await saveMapping(key, config, c.get("userId"));
    return c.json(
      {
        config: stored.config,
        parent: await resolveParent(workspaceId, "workspace"),
        updatedAt: stored.updatedAt,
      },
      200,
    );
  })
  .openapi(getProjectMappingRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const stored = await loadMapping({
      scope: "project",
      workspaceId,
      projectId,
    });
    return c.json(
      {
        config: stored?.config ?? {},
        parent: await resolveParent(workspaceId, "project", projectId),
        updatedAt: stored?.updatedAt ?? null,
      },
      200,
    );
  })
  .openapi(putProjectMappingRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { config } = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const key: MappingKey = { scope: "project", workspaceId, projectId };
    await validateMappingReferences(key, config);
    const stored = await saveMapping(key, config, c.get("userId"));
    return c.json(
      {
        config: stored.config,
        parent: await resolveParent(workspaceId, "project", projectId),
        updatedAt: stored.updatedAt,
      },
      200,
    );
  })
  .openapi(getResolvedMappingRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const mapping = await resolveMappingForUser({
      workspaceId: c.get("workspaceId"),
      projectId,
      userId: c.get("userId"),
    });
    return c.json({ mapping }, 200);
  })
  .openapi(getTokenRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const connection = await findJiraConnection(workspaceId);
    const row = connection
      ? await findJiraUserToken(connection.id, c.get("userId"))
      : null;
    return c.json(toTokenStatus(row), 200);
  })
  .openapi(putTokenRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { token, email } = c.req.valid("json");
    const userId = c.get("userId");

    assertJiraEncryptionKey();
    const connection = await requireJiraConnection(workspaceId);

    const cloud = connection.deployment === "cloud";
    if (cloud && !email) {
      throw jiraError(
        400,
        "JIRA_REQUEST_FAILED",
        "Jira Cloud needs the Atlassian account email together with the API token.",
      );
    }
    const tokenEmail = cloud ? (email ?? null) : null;

    const client = createJiraClient({
      baseUrl: connection.baseUrl,
      deployment: connection.deployment as "server" | "cloud",
      token,
      email: tokenEmail,
    });
    const identity = await withJiraErrors(() => client.myself());

    const row = await storeJiraUserToken({
      connectionId: connection.id,
      userId,
      token,
      email: tokenEmail,
      identity,
    });
    return c.json(toTokenStatus(row), 200);
  })
  .openapi(deleteTokenRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const connection = await findJiraConnection(workspaceId);
    if (connection) {
      await deleteJiraUserToken(connection.id, c.get("userId"));
    }
    return c.json({ success: true }, 200);
  })
  .openapi(getUserMappingRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const stored = await loadMapping({
      scope: "user",
      workspaceId,
      userId: c.get("userId"),
    });
    return c.json(
      {
        config: stored?.config ?? {},
        parent: await resolveParent(workspaceId, "user"),
        updatedAt: stored?.updatedAt ?? null,
      },
      200,
    );
  })
  .openapi(putUserMappingRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { config } = c.req.valid("json");
    const userId = c.get("userId");
    const key: MappingKey = { scope: "user", workspaceId, userId };
    await validateMappingReferences(key, config);
    const stored = await saveMapping(key, config, userId);
    return c.json(
      {
        config: stored.config,
        parent: await resolveParent(workspaceId, "user"),
        updatedAt: stored.updatedAt,
      },
      200,
    );
  })
  .openapi(metaProjectsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const projects = await withJiraErrors(() => client.listProjects());
    return c.json({ projects: shapeProjects(projects) }, 200);
  })
  .openapi(metaIssueTypesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { projectKey } = c.req.valid("query");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const issueTypes = await withJiraErrors(() =>
      client.listIssueTypes(projectKey),
    );
    return c.json({ issueTypes: shapeIssueTypes(issueTypes) }, 200);
  })
  .openapi(metaFieldsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { projectKey, issueTypeId } = c.req.valid("query");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const fields = await withJiraErrors(() =>
      client.getCreateFields(projectKey, issueTypeId),
    );
    return c.json({ fields: shapeFields(fields) }, 200);
  })
  .openapi(metaStatusesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { projectKey } = c.req.valid("query");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const statuses = await withJiraErrors(() =>
      client.listStatuses(projectKey),
    );
    return c.json({ statuses: shapeStatuses(statuses) }, 200);
  })
  .openapi(metaComponentsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { projectKey } = c.req.valid("query");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const components = await withJiraErrors(() =>
      client.listComponents(projectKey),
    );
    return c.json({ components: shapeComponents(components) }, 200);
  })
  .openapi(metaUsersRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { query, projectKey } = c.req.valid("query");
    const { client } = await getJiraClientForUser(workspaceId, c.get("userId"));
    const users = await withJiraErrors(() =>
      client.searchUsers(query, projectKey),
    );
    return c.json({ users: shapeUsers(users) }, 200);
  })
  .openapi(getTaskInfoRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const task = await requireTaskInWorkspace(taskId, workspaceId);
    return c.json(await loadTaskInfo(task, workspaceId), 200);
  })
  .openapi(getDraftRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const task = await requireTaskInWorkspace(taskId, workspaceId);
    const connection = await requireActiveJiraConnection(workspaceId);
    const draft = await buildTaskDraft({
      task,
      workspaceId,
      userId: c.get("userId"),
      connection,
      overrides: c.req.valid("query"),
    });
    return c.json(draft, 200);
  })
  .openapi(sendRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const task = await requireTaskInWorkspace(taskId, workspaceId);
    const result = await sendTaskToJira({
      task,
      workspaceId,
      userId: c.get("userId"),
      body: c.req.valid("json"),
    });
    return c.json(
      {
        created: result.created,
        link: toLinkResponse(result.link),
        warnings: result.warnings,
      },
      200,
    );
  })
  .openapi(refreshRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const task = await requireTaskInWorkspace(taskId, workspaceId);
    const { changed } = await refreshTaskStatus({
      task,
      workspaceId,
      userId: c.get("userId"),
    });
    return c.json(
      { changed, info: await loadTaskInfo(task, workspaceId) },
      200,
    );
  })
  .openapi(unlinkRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const task = await requireTaskInWorkspace(taskId, c.get("workspaceId"));
    await unlinkTask({ task, userId: c.get("userId") });
    return c.json({ success: true }, 200);
  })
  .openapi(acceptProposalRoute, async (c) => {
    const { proposalId } = c.req.valid("param");
    const body = c.req.valid("json") as { status?: string } | undefined;
    const proposal = await acceptProposal({
      proposalId,
      userId: c.get("userId"),
      status: body?.status,
    });
    return c.json({ proposal: toProposalResponse(proposal) }, 200);
  })
  .openapi(rejectProposalRoute, async (c) => {
    const { proposalId } = c.req.valid("param");
    const proposal = await rejectProposal({
      proposalId,
      userId: c.get("userId"),
    });
    return c.json({ proposal: toProposalResponse(proposal) }, 200);
  });

export { handleJiraWebhookRoute, jiraWebhookBodyLimit } from "./webhook";
export default jiraIntegration;
