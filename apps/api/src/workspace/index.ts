import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { toCsv } from "../utils/to-csv";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import exportWorkspaceActivities from "./controllers/export-workspace-activities";
import getWorkspaceActivities from "./controllers/get-workspace-activities";
import getWorkspaceActivityRetention from "./controllers/get-workspace-activity-retention";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import updateWorkspaceActivityRetention from "./controllers/update-workspace-activity-retention";
import {
  workspaceActivityExportSchema,
  workspaceActivityListSchema,
  workspaceActivityRetentionSchema,
  workspaceMemberListSchema,
} from "./response";
import {
  updateWorkspaceActivityRetentionBody,
  workspaceActivityExportQuery,
  workspaceActivityQuery,
  workspaceIdParam,
} from "./schema";

const EXPORT_CSV_COLUMNS = [
  "id",
  "taskId",
  "taskNumber",
  "taskTitle",
  "projectId",
  "projectName",
  "projectSlug",
  "type",
  "createdAt",
  "userId",
  "userName",
  "content",
  "eventData",
  "externalUserName",
  "externalUserAvatar",
  "externalSource",
  "externalUrl",
] as const;

const getWorkspaceMembersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMembers",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Get workspace members",
  description: "Get all members of a workspace, with their role.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of workspace members", workspaceMemberListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const getWorkspaceActivityRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceActivity",
  path: "/{workspaceId}/activity",
  tags: ["Workspaces"],
  summary: "Get workspace activity",
  description:
    "List activity across every task in the workspace, newest first: comments alongside system events such as status and assignee changes. Filter by user, activity type, or a creation-date range; paginated.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: workspaceActivityQuery },
  responses: {
    200: jsonResponse(
      "Paginated workspace activity",
      workspaceActivityListSchema,
    ),
    400: errorResponse(
      "Workspace ID could not be determined, or invalid query",
    ),
    403: errorResponse(
      "No access to the workspace, or missing task:read permission",
    ),
  },
});

const getWorkspaceActivityExportRoute = createRoute({
  method: "get",
  operationId: "exportWorkspaceActivity",
  path: "/{workspaceId}/activity/export",
  tags: ["Workspaces"],
  summary: "Export workspace activity",
  description:
    'Export activity across every task in the workspace as CSV or JSON, honoring the same filters and permission as GET /activity. Unpaginated, newest first, capped at 10,000 rows: narrow the filters if the "truncated" flag (or the X-Kaneo-Export-Truncated header on a CSV response) comes back true.',
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: workspaceActivityExportQuery },
  responses: {
    200: {
      description: "The workspace activity export, as CSV or JSON",
      content: {
        "text/csv": {
          schema: z.string().openapi({
            description: "Returned when format=csv (the default).",
          }),
        },
        "application/json": {
          schema: workspaceActivityExportSchema.openapi({
            description: "Returned when format=json.",
          }),
        },
      },
    },
    400: errorResponse(
      "Workspace ID could not be determined, or invalid query",
    ),
    403: errorResponse(
      "No access to the workspace, or missing task:read permission",
    ),
  },
});

const getWorkspaceActivityRetentionRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceActivityRetention",
  path: "/{workspaceId}/activity-retention",
  tags: ["Workspaces"],
  summary: "Get the workspace activity retention setting",
  description:
    "Read how many days of activity history this workspace keeps. Null means retention is disabled (keep forever), which is the default. This is a stored setting only; no automatic deletion currently enforces it.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The workspace's activity retention setting",
      workspaceActivityRetentionSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace not found"),
  },
});

const updateWorkspaceActivityRetentionRoute = createRoute({
  method: "patch",
  operationId: "updateWorkspaceActivityRetention",
  path: "/{workspaceId}/activity-retention",
  tags: ["Workspaces"],
  summary: "Update the workspace activity retention setting",
  description:
    "Set how many days of activity history to keep. 0 or null disables retention (keep forever). This only stores the setting; it does not itself delete anything.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateWorkspaceActivityRetentionBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated activity retention setting",
      workspaceActivityRetentionSchema,
    ),
    400: errorResponse("Workspace ID could not be determined, or invalid body"),
    403: errorResponse(
      "No access to the workspace, or missing workspace:manage_settings permission",
    ),
    404: errorResponse("Workspace not found"),
  },
});

const workspace = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getWorkspaceMembersRoute, async (c) =>
    c.json(await getWorkspaceMembersCtrl(c.get("workspaceId")), 200),
  )
  .openapi(getWorkspaceActivityRoute, async (c) =>
    c.json(
      await getWorkspaceActivities(c.get("workspaceId"), c.req.valid("query")),
      200,
    ),
  )
  .openapi(getWorkspaceActivityExportRoute, async (c) => {
    const { format, ...filters } = c.req.valid("query");
    const { data, truncated } = await exportWorkspaceActivities(
      c.get("workspaceId"),
      filters,
    );

    c.header("Cache-Control", "private, no-store");
    c.header("X-Kaneo-Export-Truncated", truncated ? "true" : "false");

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      c.header(
        "Content-Disposition",
        `attachment; filename="workspace-activity-export-${stamp}.json"`,
      );
      return c.json({ data, truncated }, 200);
    }

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="workspace-activity-export-${stamp}.csv"`,
    );
    return c.body(toCsv(data, [...EXPORT_CSV_COLUMNS]), 200);
  })
  .openapi(getWorkspaceActivityRetentionRoute, async (c) =>
    c.json(await getWorkspaceActivityRetention(c.get("workspaceId")), 200),
  )
  .openapi(updateWorkspaceActivityRetentionRoute, async (c) =>
    c.json(
      await updateWorkspaceActivityRetention(
        c.get("workspaceId"),
        c.req.valid("json").activityRetentionDays,
      ),
      200,
    ),
  );

export default workspace;
