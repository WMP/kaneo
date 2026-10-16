import { responseTimestamp, z } from "../openapi";
import {
  INFRA_CLUSTER_KINDS,
  INFRA_HOST_STATUSES,
  INFRA_PROVIDERS,
} from "./schema";

const statusSchema = z.enum(INFRA_HOST_STATUSES);
const availableFrom = z.string().nullable().openapi({
  description:
    "Date-only (YYYY-MM-DD): the expected delivery date while ordered, the installation date once installed.",
  example: "2026-11-30",
});

const totalsSchema = z
  .object({
    vmCount: z.number().int(),
    vcpu: z.number().int(),
    ramGb: z.number().int(),
    localStorageGb: z.number().int(),
    cephStorageGb: z.number().int().openapi({
      description:
        "Ceph storage of the VMs on the host. Informational: it counts against the Ceph clusters, not the host.",
    }),
  })
  .openapi("InfraHostTotals");

const modelSummaryFields = {
  id: z.string(),
  name: z.string(),
  provider: z.enum(INFRA_PROVIDERS),
  family: z.string().nullable(),
  ramGb: z.number().int(),
  vcpu: z.number().int(),
  storageGb: z
    .number()
    .int()
    .openapi({ description: "Local disk of the host, in GB." }),
  leadTimeDays: z.number().int(),
  hypervisorReserveGb: z.number().int().openapi({
    description: "RAM kept for the hypervisor on each host, in GB.",
  }),
};

export const infraModelSchema = z
  .object({
    ...modelSummaryFields,
    projectId: z.string(),
    regions: z.array(z.string()),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("InfraModel");

export const infraModelListSchema = z
  .array(infraModelSchema)
  .openapi("InfraModelList");

export const infraModelSummarySchema = z
  .object(modelSummaryFields)
  .openapi("InfraModelSummary");

const hostFields = {
  id: z.string(),
  projectId: z.string(),
  modelId: z.string(),
  region: z.string(),
  zone: z.string().nullable(),
  label: z.string(),
  status: statusSchema,
  availableFrom,
  hostname: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
};

export const infraHostSchema = z
  .object({
    ...hostFields,
    model: infraModelSummarySchema,
    totals: totalsSchema,
  })
  .openapi("InfraHost");

export const infraHostListSchema = z
  .array(infraHostSchema)
  .openapi("InfraHostList");

// A host as the datacenter team sees it: with its project, never with task
// titles.
export const infraDatacenterHostSchema = z
  .object({
    ...hostFields,
    projectName: z.string(),
    model: infraModelSummarySchema,
    totals: totalsSchema,
  })
  .openapi("InfraDatacenterHost");

export const infraDatacenterHostListSchema = z
  .array(infraDatacenterHostSchema)
  .openapi("InfraDatacenterHostList");

export const infraVmSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    hostId: z.string().nullable(),
    name: z.string(),
    vcpu: z.number().int(),
    ramGb: z.number().int(),
    localStorageGb: z.number().int(),
    cephStorageGb: z.number().int(),
    storageClusterId: z.string().nullable(),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    storageCluster: z
      .object({
        id: z.string(),
        name: z.string(),
        region: z.string(),
        kind: z.enum(INFRA_CLUSTER_KINDS),
      })
      .nullable()
      .openapi("InfraVmStorageCluster"),
    host: z
      .object({
        id: z.string(),
        label: z.string(),
        region: z.string(),
        zone: z.string().nullable(),
        status: statusSchema,
        availableFrom,
      })
      .nullable()
      .openapi("InfraVmHost"),
  })
  .openapi("InfraVm");

export const infraVmListSchema = z.array(infraVmSchema).openapi("InfraVmList");

export const deletedInfraItemSchema = z
  .object({ id: z.string() })
  .openapi("DeletedInfraItem");

const clusterKind = z.enum(INFRA_CLUSTER_KINDS);

// What a project sees of a cluster: never capacity or use.
export const infraStorageClusterSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    region: z.string(),
    kind: clusterKind,
  })
  .openapi("InfraStorageClusterSummary");

export const infraStorageClusterSummaryListSchema = z
  .array(infraStorageClusterSummarySchema)
  .openapi("InfraStorageClusterSummaryList");

export const infraStorageCapacitySchema = z
  .object({
    id: z.string(),
    clusterId: z.string(),
    label: z.string(),
    modelName: z.string().nullable(),
    capacityGb: z.number().int(),
    status: statusSchema,
    availableFrom,
    hostname: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("InfraStorageCapacity");

const clusterFields = {
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  region: z.string(),
  kind: clusterKind,
  ecDataChunks: z.number().int().nullable(),
  ecCodingChunks: z.number().int().nullable(),
  fillThresholdPercent: z.number().int(),
  leadTimeDays: z.number().int(),
  position: z.number().int(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
};

export const infraStorageClusterSchema = z
  .object({
    ...clusterFields,
    capacity: z.array(infraStorageCapacitySchema),
    totals: z
      .object({
        rawCapacityGb: z.number().int().openapi({
          description: "Sum of the installed capacity entries.",
        }),
        plannedOrOrderedCapacityGb: z.number().int(),
        usedCephGb: z.number().int().openapi({
          description:
            "Ceph storage of the VMs that use the cluster, across all projects.",
        }),
        vmCount: z.number().int(),
      })
      .openapi("InfraStorageClusterTotals"),
  })
  .openapi("InfraStorageCluster");

export const infraStorageClusterListSchema = z
  .array(infraStorageClusterSchema)
  .openapi("InfraStorageClusterList");

const dateOrNull = z.string().nullable();
const percentOrNull = z.number().nullable();

export const infraHostCapacityResultSchema = z
  .object({
    hostId: z.string(),
    usableRamGb: z.number().int(),
    vcpu: z.number().int(),
    localStorageGb: z.number().int(),
    needDate: dateOrNull.openapi({
      description: "Earliest start date of a task with a VM on the host.",
    }),
    orderByDate: dateOrNull.openapi({
      description: "needDate minus the model lead time.",
    }),
    steps: z.array(
      z.object({
        date: z.string(),
        ramGb: z.number().int(),
        vcpu: z.number().int(),
        localStorageGb: z.number().int(),
        ramPercent: percentOrNull,
        vcpuPercent: percentOrNull,
        localStoragePercent: percentOrNull,
      }),
    ),
    peakRamPercent: percentOrNull,
    firstOver80Date: dateOrNull,
    firstOver100Date: dateOrNull,
  })
  .openapi("InfraHostCapacityResult");

export const infraClusterCapacityResultSchema = z
  .object({
    clusterId: z.string(),
    needDate: dateOrNull,
    steps: z.array(
      z.object({
        date: z.string(),
        usedCephGb: z.number().int(),
        usableGb: z.number().int(),
        percent: percentOrNull,
      }),
    ),
    firstOver80Date: dateOrNull,
    firstOver100Date: dateOrNull,
    usableAllGb: z.number().int(),
    shortfallGb: z.number().int(),
    plannedNeedDate: dateOrNull,
    suggestion: z
      .object({
        kind: z.enum(["nodes", "service"]),
        shortfallGb: z.number().int(),
        nodes: z.number().int().nullable(),
        nodeCapacityGb: z.number().int().nullable(),
        modelName: z.string().nullable(),
        buyGb: z.number().int().nullable(),
        needDate: dateOrNull,
        orderByDate: dateOrNull,
      })
      .nullable()
      .openapi("InfraClusterSuggestion"),
  })
  .openapi("InfraClusterCapacityResult");

export const infraCapacityWarningSchema = z
  .object({
    type: z.enum([
      "HOST_NOT_READY",
      "ORDER_LATE",
      "OVER_100",
      "OVER_80",
      "VM_UNPLACED",
      "VM_UNSCHEDULED",
      "CLUSTER_NOT_READY",
      "CLUSTER_SHORTFALL",
    ]),
    severity: z.enum(["error", "warning", "info"]),
    hostId: z.string().optional(),
    clusterId: z.string().optional(),
    vmId: z.string().optional(),
    vmName: z.string().optional(),
    taskId: z.string().optional(),
    taskTitle: z.string().optional(),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    date: z.string().optional(),
  })
  .openapi("InfraCapacityWarning", {
    description:
      "Task ids and titles appear only on the project route. The datacenter route names the VM and its project.",
  });

const capacityHostSummary = z
  .object({
    id: z.string(),
    label: z.string(),
    region: z.string(),
    zone: z.string().nullable(),
    status: statusSchema,
    availableFrom,
    hostname: z.string().nullable(),
    projectId: z.string(),
    projectName: z.string(),
    model: z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      family: z.string().nullable(),
      ramGb: z.number().int(),
      vcpu: z.number().int(),
      storageGb: z.number().int(),
      leadTimeDays: z.number().int(),
      hypervisorReserveGb: z.number().int().openapi({
        description: "RAM kept for the hypervisor on each host, in GB.",
      }),
    }),
  })
  .openapi("InfraCapacityHost");

const capacityHost = z
  .object({ host: capacityHostSummary, result: infraHostCapacityResultSchema })
  .openapi("InfraHostCapacity");

const projectVm = z
  .object({
    id: z.string(),
    name: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    hostId: z.string().nullable(),
    startDate: z.string().nullable(),
    cephStorageGb: z.number().int(),
    storageCluster: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi("InfraCapacityVmCluster"),
  })
  .openapi("InfraCapacityVm");

export const infraProjectCapacitySchema = z
  .object({
    today: z.string(),
    hosts: z.array(capacityHost),
    warnings: z.array(infraCapacityWarningSchema),
    unplacedVms: z.array(projectVm),
    unscheduledVms: z.array(projectVm),
  })
  .openapi("InfraProjectCapacity");

export const infraOrderPlanRowSchema = z
  .object({
    type: z.enum(["host", "storage_node", "storage_service"]),
    orderByDate: dateOrNull,
    needDate: dateOrNull,
    provider: z.string().nullable(),
    region: z.string(),
    zone: z.string().nullable(),
    model: z.string().nullable(),
    family: z.string().nullable(),
    ramGb: z.number().int().nullable(),
    vcpu: z.number().int().nullable(),
    storageGb: z.number().int().nullable(),
    quantity: z.number().int(),
    capacityGb: z.number().int().nullable(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    clusterId: z.string().nullable(),
    clusterName: z.string().nullable(),
    labels: z.array(z.string()),
    status: z.enum(["planned", "suggested"]),
    late: z.boolean(),
  })
  .openapi("InfraOrderPlanRow");

export const infraWorkspaceCapacitySchema = z
  .object({
    today: z.string(),
    hosts: z.array(capacityHost),
    clusters: z.array(
      z
        .object({
          cluster: z.object({
            id: z.string(),
            name: z.string(),
            region: z.string(),
            kind: clusterKind,
            ecDataChunks: z.number().int().nullable(),
            ecCodingChunks: z.number().int().nullable(),
            fillThresholdPercent: z.number().int(),
            leadTimeDays: z.number().int(),
          }),
          result: infraClusterCapacityResultSchema,
        })
        .openapi("InfraClusterCapacity"),
    ),
    warnings: z.array(infraCapacityWarningSchema),
    orderPlan: z.array(infraOrderPlanRowSchema),
  })
  .openapi("InfraWorkspaceCapacity");

export const infraRegionSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    zones: z.array(z.string()),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    zoneUsage: z.record(z.string(), z.number().int()).openapi({
      description: "Hosts per zone code.",
    }),
    usage: z
      .object({
        models: z.number().int(),
        hosts: z.number().int(),
        clusters: z.number().int(),
      })
      .openapi("InfraRegionUsage"),
  })
  .openapi("InfraRegion");

export const infraRegionListSchema = z
  .array(infraRegionSchema)
  .openapi("InfraRegionList");

// What a project sees of the catalog.
export const infraRegionSummaryListSchema = z
  .array(
    z
      .object({
        code: z.string(),
        name: z.string(),
        zones: z.array(z.string()),
      })
      .openapi("InfraRegionSummary"),
  )
  .openapi("InfraRegionSummaryList");

export const infraCreatedHostsSchema = z
  .object({ hosts: z.array(infraHostSchema) })
  .openapi("InfraCreatedHosts");
