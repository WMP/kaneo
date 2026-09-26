import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getWorkspaceActivities from "./controllers/get-workspace-activities";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import {
  workspaceActivityListSchema,
  workspaceMemberListSchema,
} from "./response";
import { workspaceActivityQuery, workspaceIdParam } from "./schema";

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

const workspace = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getWorkspaceMembersRoute, async (c) =>
    c.json(await getWorkspaceMembersCtrl(c.get("workspaceId")), 200),
  )
  .openapi(getWorkspaceActivityRoute, async (c) =>
    c.json(
      await getWorkspaceActivities(c.get("workspaceId"), c.req.valid("query")),
      200,
    ),
  );

export default workspace;
