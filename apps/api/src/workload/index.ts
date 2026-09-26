import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getWorkspaceWorkloadCtrl from "./controllers/get-workspace-workload";
import { workloadResponseSchema } from "./response";
import { workloadQuery, workspaceIdParam } from "./schema";

const getWorkspaceWorkloadRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceWorkload",
  path: "/{workspaceId}",
  tags: ["Workload"],
  summary: "Get workspace workload",
  description:
    "Aggregate a workspace's dated, not-done tasks by assignee over weekly buckets across a date range, for spotting who is overloaded. A task with neither a start nor a due date is excluded; one with only a start or only a due date counts as a single day on that date. Unassigned tasks are grouped into their own row.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: workloadQuery },
  responses: {
    200: jsonResponse("Per-assignee weekly workload", workloadResponseSchema),
    400: errorResponse(
      "Workspace ID could not be determined, or the date range is invalid",
    ),
    403: errorResponse("No access to the workspace"),
  },
});

const workload = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  getWorkspaceWorkloadRoute,
  async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { from, to } = c.req.valid("query");

    return c.json(
      await getWorkspaceWorkloadCtrl({
        workspaceId,
        from: new Date(from),
        to: new Date(to),
      }),
      200,
    );
  },
);

export default workload;
