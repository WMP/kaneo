import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { codedErrorResponse } from "../utils/coded-error";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  buildOrderPlanWorkbook,
  getProjectCapacity,
  getWorkspaceCapacity,
  getWorkspaceSlug,
  todayUtc,
} from "./controllers/capacity";
import {
  createHost,
  deleteHost,
  listProjectHosts,
  listWorkspaceHosts,
  setHostStatus,
  updateHost,
} from "./controllers/hosts";
import {
  createModel,
  deleteModel,
  listModels,
  updateModel,
} from "./controllers/models";
import {
  createCapacity,
  createCluster,
  deleteCapacity,
  deleteCluster,
  listClusterSummaries,
  listClusters,
  updateCapacity,
  updateCluster,
} from "./controllers/storage";
import { listTaskVms, replaceTaskVms } from "./controllers/vms";
import {
  deletedInfraItemSchema,
  infraDatacenterHostListSchema,
  infraDatacenterHostSchema,
  infraHostListSchema,
  infraHostSchema,
  infraModelListSchema,
  infraModelSchema,
  infraProjectCapacitySchema,
  infraStorageCapacitySchema,
  infraStorageClusterListSchema,
  infraStorageClusterSchema,
  infraStorageClusterSummaryListSchema,
  infraVmListSchema,
  infraWorkspaceCapacitySchema,
} from "./response";
import {
  createCapacityBody,
  createClusterBody,
  createHostBody,
  createModelBody,
  hostParam,
  modelParam,
  projectIdParam,
  replaceVmsBody,
  setHostStatusBody,
  taskIdParam,
  updateCapacityBody,
  updateClusterBody,
  updateHostBody,
  updateModelBody,
  workspaceCapacityParam,
  workspaceClusterParam,
  workspaceHostParam,
  workspaceIdParam,
} from "./schema";

// `infrastructure` is a project-level resource: the caller's role IN the
// project decides. `datacenter` is workspace-level: the workspace role decides,
// and no project membership is needed. Every controller scopes its rows by the
// project (or workspace) of the route, so an id of another project answers 404.
const forbidden = errorResponse(
  "No access to the project, or missing permission",
);
const dcForbidden = errorResponse(
  "No workspace access, or missing datacenter permission",
);

function jsonBody<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const getModelsRoute = createRoute({
  method: "get",
  operationId: "getInfraModels",
  path: "/project/{projectId}/models",
  tags: ["Infrastructure"],
  summary: "List the server model pool of a project",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Models by position", infraModelListSchema),
    403: forbidden,
  },
});

const createModelRoute = createRoute({
  method: "post",
  operationId: "createInfraModel",
  path: "/project/{projectId}/models",
  tags: ["Infrastructure"],
  summary: "Create a server model in the pool of a project",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["manage"] }),
  ] as const,
  request: { params: projectIdParam, body: jsonBody(createModelBody) },
  responses: {
    200: jsonResponse("Model created", infraModelSchema),
    400: errorResponse("Invalid model"),
    403: forbidden,
  },
});

const updateModelRoute = createRoute({
  method: "put",
  operationId: "updateInfraModel",
  path: "/project/{projectId}/models/{modelId}",
  tags: ["Infrastructure"],
  summary: "Update a server model",
  description:
    "Only the sent fields change. Removing a region that a host uses answers 409 with code `INFRA_REGION_IN_USE`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["manage"] }),
  ] as const,
  request: { params: modelParam, body: jsonBody(updateModelBody) },
  responses: {
    200: jsonResponse("Model updated", infraModelSchema),
    400: errorResponse("Invalid model"),
    403: forbidden,
    404: errorResponse("Model not found in this project"),
    409: codedErrorResponse("A region is used by a host (INFRA_REGION_IN_USE)"),
  },
});

const deleteModelRoute = createRoute({
  method: "delete",
  operationId: "deleteInfraModel",
  path: "/project/{projectId}/models/{modelId}",
  tags: ["Infrastructure"],
  summary: "Delete a server model",
  description:
    "A model that a host uses answers 409 with code `INFRA_MODEL_IN_USE`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["manage"] }),
  ] as const,
  request: { params: modelParam },
  responses: {
    200: jsonResponse("Model deleted", deletedInfraItemSchema),
    403: forbidden,
    404: errorResponse("Model not found in this project"),
    409: codedErrorResponse("A host uses the model (INFRA_MODEL_IN_USE)"),
  },
});

const getHostsRoute = createRoute({
  method: "get",
  operationId: "getInfraHosts",
  path: "/project/{projectId}/hosts",
  tags: ["Infrastructure"],
  summary: "List the hosts of a project",
  description:
    "Hosts with their model and the totals of the VMs placed on them.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Hosts of the project", infraHostListSchema),
    403: forbidden,
  },
});

const createHostRoute = createRoute({
  method: "post",
  operationId: "createInfraHost",
  path: "/project/{projectId}/hosts",
  tags: ["Infrastructure"],
  summary: "Create a planned host from the model pool",
  description:
    "The host starts `planned`. Without a label it is named `<model name> <ram> GB <region> #<n>`, n being the highest number used for the model and region in the project plus one. A region outside the model answers 400 with code `INFRA_REGION_NOT_ALLOWED`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["plan"] }),
  ] as const,
  request: { params: projectIdParam, body: jsonBody(createHostBody) },
  responses: {
    200: jsonResponse("Host created", infraHostSchema),
    400: codedErrorResponse(
      "Invalid host or region (INFRA_REGION_NOT_ALLOWED)",
    ),
    403: forbidden,
    404: errorResponse("Model not found in this project"),
  },
});

const updateHostRoute = createRoute({
  method: "put",
  operationId: "updateInfraHost",
  path: "/project/{projectId}/hosts/{hostId}",
  tags: ["Infrastructure"],
  summary: "Rename a host or change its region",
  description:
    "A region change is allowed only while the host is `planned` (else 409 `INFRA_HOST_LOCKED`) and must be a region of the model (else 400 `INFRA_REGION_NOT_ALLOWED`).",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["plan"] }),
  ] as const,
  request: { params: hostParam, body: jsonBody(updateHostBody) },
  responses: {
    200: jsonResponse("Host updated", infraHostSchema),
    400: codedErrorResponse(
      "Invalid host or region (INFRA_REGION_NOT_ALLOWED)",
    ),
    403: forbidden,
    404: errorResponse("Host not found in this project"),
    409: codedErrorResponse("The host is not planned (INFRA_HOST_LOCKED)"),
  },
});

const deleteHostRoute = createRoute({
  method: "delete",
  operationId: "deleteInfraHost",
  path: "/project/{projectId}/hosts/{hostId}",
  tags: ["Infrastructure"],
  summary: "Delete a planned host",
  description:
    "Only a `planned` host can be deleted (else 409 `INFRA_HOST_LOCKED`). Its VMs stay in their tasks without a host.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["manage"] }),
  ] as const,
  request: { params: hostParam },
  responses: {
    200: jsonResponse("Host deleted", deletedInfraItemSchema),
    403: forbidden,
    404: errorResponse("Host not found in this project"),
    409: codedErrorResponse("The host is not planned (INFRA_HOST_LOCKED)"),
  },
});

const getVmsRoute = createRoute({
  method: "get",
  operationId: "getTaskInfraVms",
  path: "/task/{taskId}/vms",
  tags: ["Infrastructure"],
  summary: "List the VMs of a task",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ infrastructure: ["read"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("VMs of the task with their host", infraVmListSchema),
    400: errorResponse("Unknown task"),
    403: forbidden,
  },
});

const replaceVmsRoute = createRoute({
  method: "put",
  operationId: "replaceTaskInfraVms",
  path: "/task/{taskId}/vms",
  tags: ["Infrastructure"],
  summary: "Replace the VMs of a task",
  description:
    "One transaction: items with an `id` of this task are updated, items without an id are created, existing VMs missing from the list are deleted. At most 200 items. A host of another project answers 400 `INFRA_HOST_NOT_IN_PROJECT`, an id that is not a VM of this task 400 `INFRA_VM_NOT_IN_TASK`; nothing is persisted then.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ infrastructure: ["plan"] }),
  ] as const,
  request: { params: taskIdParam, body: jsonBody(replaceVmsBody) },
  responses: {
    200: jsonResponse("The new list", infraVmListSchema),
    400: codedErrorResponse(
      "Invalid list (INFRA_HOST_NOT_IN_PROJECT, INFRA_VM_NOT_IN_TASK)",
    ),
    403: forbidden,
  },
});

const getWorkspaceHostsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceInfraHosts",
  path: "/workspace/{workspaceId}/hosts",
  tags: ["Infrastructure"],
  summary: "List the hosts of every project of a workspace (datacenter)",
  description:
    "Project name, model, status, dates and VM totals. Task titles are never included.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Hosts of the workspace", infraDatacenterHostListSchema),
    403: dcForbidden,
  },
});

const setHostStatusRoute = createRoute({
  method: "put",
  operationId: "setInfraHostStatus",
  path: "/workspace/{workspaceId}/hosts/{hostId}/status",
  tags: ["Infrastructure"],
  summary: "Set the status of a host (datacenter)",
  description:
    "`ordered` needs `availableFrom` (expected delivery, 400 `INFRA_AVAILABLE_FROM_REQUIRED`). `installed` without a date stores today. `planned` clears the date. A host of another workspace answers 404.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: { params: workspaceHostParam, body: jsonBody(setHostStatusBody) },
  responses: {
    200: jsonResponse("Host updated", infraDatacenterHostSchema),
    400: codedErrorResponse(
      "Invalid status change (INFRA_AVAILABLE_FROM_REQUIRED)",
    ),
    403: dcForbidden,
    404: errorResponse("Host not found in this workspace"),
  },
});

const getProjectClustersRoute = createRoute({
  method: "get",
  operationId: "getProjectInfraStorageClusters",
  path: "/project/{projectId}/storage-clusters",
  tags: ["Infrastructure"],
  summary: "List the Ceph storage clusters a VM of the project may use",
  description:
    "The clusters of the project's workspace with id, name, region and kind only. Capacity and use are never included.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Storage cluster summaries",
      infraStorageClusterSummaryListSchema,
    ),
    403: forbidden,
  },
});

const getClustersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceInfraStorageClusters",
  path: "/workspace/{workspaceId}/storage-clusters",
  tags: ["Infrastructure"],
  summary: "List the Ceph storage clusters of a workspace (datacenter)",
  description:
    "Every cluster with its capacity entries and totals: installed raw capacity, planned or ordered capacity, and the Ceph storage used by VMs of all projects.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Storage clusters", infraStorageClusterListSchema),
    403: dcForbidden,
  },
});

const clusterErrors = {
  400: codedErrorResponse("Invalid cluster (INFRA_CLUSTER_INVALID)"),
  403: dcForbidden,
  404: errorResponse("Cluster not found in this workspace"),
  409: codedErrorResponse(
    "Name taken (INFRA_CLUSTER_NAME_TAKEN) or cluster in use (INFRA_CLUSTER_IN_USE)",
  ),
};

const createClusterRoute = createRoute({
  method: "post",
  operationId: "createInfraStorageCluster",
  path: "/workspace/{workspaceId}/storage-clusters",
  tags: ["Infrastructure"],
  summary: "Create a Ceph storage cluster (datacenter)",
  description:
    "`self_managed` needs ecDataChunks (k) and ecCodingChunks (m); `managed_service` has neither. The name is unique in the workspace (409 `INFRA_CLUSTER_NAME_TAKEN`).",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: { params: workspaceIdParam, body: jsonBody(createClusterBody) },
  responses: {
    200: jsonResponse("Cluster created", infraStorageClusterSchema),
    ...clusterErrors,
  },
});

const updateClusterRoute = createRoute({
  method: "put",
  operationId: "updateInfraStorageCluster",
  path: "/workspace/{workspaceId}/storage-clusters/{clusterId}",
  tags: ["Infrastructure"],
  summary: "Update a Ceph storage cluster (datacenter)",
  description:
    "Only the sent fields change. Switching to `managed_service` clears k and m; switching to `self_managed` needs them.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: { params: workspaceClusterParam, body: jsonBody(updateClusterBody) },
  responses: {
    200: jsonResponse("Cluster updated", infraStorageClusterSchema),
    ...clusterErrors,
  },
});

const deleteClusterRoute = createRoute({
  method: "delete",
  operationId: "deleteInfraStorageCluster",
  path: "/workspace/{workspaceId}/storage-clusters/{clusterId}",
  tags: ["Infrastructure"],
  summary: "Delete a Ceph storage cluster (datacenter)",
  description:
    "A cluster that a VM uses answers 409 with code `INFRA_CLUSTER_IN_USE`.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: { params: workspaceClusterParam },
  responses: {
    200: jsonResponse("Cluster deleted", deletedInfraItemSchema),
    ...clusterErrors,
  },
});

const capacityErrors = {
  400: codedErrorResponse("Invalid entry (INFRA_AVAILABLE_FROM_REQUIRED)"),
  403: dcForbidden,
  404: errorResponse("Cluster or entry not found in this workspace"),
  409: codedErrorResponse("The entry is not planned (INFRA_CAPACITY_LOCKED)"),
};

const createCapacityRoute = createRoute({
  method: "post",
  operationId: "createInfraStorageCapacity",
  path: "/workspace/{workspaceId}/storage-clusters/{clusterId}/capacity",
  tags: ["Infrastructure"],
  summary: "Add a capacity entry to a cluster (datacenter)",
  description:
    "The entry starts `planned`. Without a label it is named `<cluster name> #<n>`, n being the highest number used in the cluster plus one.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: {
    params: workspaceClusterParam,
    body: jsonBody(createCapacityBody),
  },
  responses: {
    200: jsonResponse("Entry created", infraStorageCapacitySchema),
    ...capacityErrors,
  },
});

const updateCapacityRoute = createRoute({
  method: "put",
  operationId: "updateInfraStorageCapacity",
  path: "/workspace/{workspaceId}/storage-clusters/{clusterId}/capacity/{entryId}",
  tags: ["Infrastructure"],
  summary: "Update a capacity entry (datacenter)",
  description:
    "Status rules as for hosts: `ordered` needs `availableFrom` (400 `INFRA_AVAILABLE_FROM_REQUIRED`), `installed` without a date stores today, `planned` clears the date.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: {
    params: workspaceCapacityParam,
    body: jsonBody(updateCapacityBody),
  },
  responses: {
    200: jsonResponse("Entry updated", infraStorageCapacitySchema),
    ...capacityErrors,
  },
});

const deleteCapacityRoute = createRoute({
  method: "delete",
  operationId: "deleteInfraStorageCapacity",
  path: "/workspace/{workspaceId}/storage-clusters/{clusterId}/capacity/{entryId}",
  tags: ["Infrastructure"],
  summary: "Delete a planned capacity entry (datacenter)",
  description:
    "Only a `planned` entry can be deleted (else 409 `INFRA_CAPACITY_LOCKED`).",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["manage"] }),
  ] as const,
  request: { params: workspaceCapacityParam },
  responses: {
    200: jsonResponse("Entry deleted", deletedInfraItemSchema),
    ...capacityErrors,
  },
});

const getProjectCapacityRoute = createRoute({
  method: "get",
  operationId: "getProjectInfraCapacity",
  path: "/project/{projectId}/capacity",
  tags: ["Infrastructure"],
  summary: "Day-by-day capacity of the hosts of a project",
  description:
    "Per host: need date, order-by date, use steps, first day over 80 and over 100 percent. Warnings carry the ids and titles of this project's tasks. Ceph cluster capacity and use are not included.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ infrastructure: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Capacity of the project", infraProjectCapacitySchema),
    403: forbidden,
  },
});

const getWorkspaceCapacityRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceInfraCapacity",
  path: "/workspace/{workspaceId}/capacity",
  tags: ["Infrastructure"],
  summary:
    "Capacity of every host and Ceph cluster, and the order plan (datacenter)",
  description:
    "Hosts of every project, Ceph clusters, warnings and the order plan. Warnings name VMs and projects; task titles and task ids are never included.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "Capacity of the workspace",
      infraWorkspaceCapacitySchema,
    ),
    403: dcForbidden,
  },
});

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const getOrderPlanXlsxRoute = createRoute({
  method: "get",
  operationId: "getInfraOrderPlanXlsx",
  path: "/workspace/{workspaceId}/order-plan.xlsx",
  tags: ["Infrastructure"],
  summary: "Export the order plan as an XLSX file (datacenter)",
  description:
    "One sheet, `Order plan`, with a row per planned host group, planned storage entry and storage suggestion, sorted by order-by date, region and model. Late rows are highlighted.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ datacenter: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: {
      description: "The order plan workbook",
      content: {
        [XLSX_TYPE]: {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    403: dcForbidden,
  },
});

const infrastructure = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getModelsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await listModels(projectId), 200);
  })
  .openapi(createModelRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await createModel(projectId, c.req.valid("json")), 200);
  })
  .openapi(updateModelRoute, async (c) => {
    const { projectId, modelId } = c.req.valid("param");
    return c.json(
      await updateModel(projectId, modelId, c.req.valid("json")),
      200,
    );
  })
  .openapi(deleteModelRoute, async (c) => {
    const { projectId, modelId } = c.req.valid("param");
    return c.json(await deleteModel(projectId, modelId), 200);
  })
  .openapi(getHostsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await listProjectHosts(projectId), 200);
  })
  .openapi(createHostRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await createHost(projectId, c.req.valid("json")), 200);
  })
  .openapi(updateHostRoute, async (c) => {
    const { projectId, hostId } = c.req.valid("param");
    return c.json(
      await updateHost(projectId, hostId, c.req.valid("json")),
      200,
    );
  })
  .openapi(deleteHostRoute, async (c) => {
    const { projectId, hostId } = c.req.valid("param");
    return c.json(await deleteHost(projectId, hostId), 200);
  })
  .openapi(getVmsRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    return c.json(await listTaskVms(taskId), 200);
  })
  .openapi(replaceVmsRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const { vms } = c.req.valid("json");
    return c.json(await replaceTaskVms(taskId, vms), 200);
  })
  .openapi(getWorkspaceHostsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await listWorkspaceHosts(workspaceId), 200);
  })
  .openapi(getProjectClustersRoute, async (c) => {
    return c.json(await listClusterSummaries(c.get("workspaceId")), 200);
  })
  .openapi(getClustersRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await listClusters(workspaceId), 200);
  })
  .openapi(createClusterRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await createCluster(workspaceId, c.req.valid("json")), 200);
  })
  .openapi(updateClusterRoute, async (c) => {
    const { workspaceId, clusterId } = c.req.valid("param");
    return c.json(
      await updateCluster(workspaceId, clusterId, c.req.valid("json")),
      200,
    );
  })
  .openapi(deleteClusterRoute, async (c) => {
    const { workspaceId, clusterId } = c.req.valid("param");
    return c.json(await deleteCluster(workspaceId, clusterId), 200);
  })
  .openapi(createCapacityRoute, async (c) => {
    const { workspaceId, clusterId } = c.req.valid("param");
    return c.json(
      await createCapacity(workspaceId, clusterId, c.req.valid("json")),
      200,
    );
  })
  .openapi(updateCapacityRoute, async (c) => {
    const { workspaceId, clusterId, entryId } = c.req.valid("param");
    return c.json(
      await updateCapacity(
        workspaceId,
        clusterId,
        entryId,
        c.req.valid("json"),
      ),
      200,
    );
  })
  .openapi(deleteCapacityRoute, async (c) => {
    const { workspaceId, clusterId, entryId } = c.req.valid("param");
    return c.json(await deleteCapacity(workspaceId, clusterId, entryId), 200);
  })
  .openapi(getProjectCapacityRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getProjectCapacity(projectId), 200);
  })
  .openapi(getWorkspaceCapacityRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await getWorkspaceCapacity(workspaceId), 200);
  })
  .openapi(getOrderPlanXlsxRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { orderPlan } = await getWorkspaceCapacity(workspaceId);
    const [file, slug] = await Promise.all([
      buildOrderPlanWorkbook(orderPlan),
      getWorkspaceSlug(workspaceId),
    ]);
    const safeSlug = slug.replace(/[^A-Za-z0-9_-]/g, "-");
    c.header("Content-Type", XLSX_TYPE);
    c.header(
      "Content-Disposition",
      `attachment; filename="order-plan-${safeSlug}-${todayUtc()}.xlsx"`,
    );
    return c.body(new Uint8Array(file), 200);
  })
  .openapi(setHostStatusRoute, async (c) => {
    const { workspaceId, hostId } = c.req.valid("param");
    return c.json(
      await setHostStatus(workspaceId, hostId, c.req.valid("json")),
      200,
    );
  });

export default infrastructure;
