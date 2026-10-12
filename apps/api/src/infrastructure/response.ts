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
  hypervisorReservePercent: z.number().int(),
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
