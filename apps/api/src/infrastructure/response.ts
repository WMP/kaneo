import { responseTimestamp, z } from "../openapi";
import { INFRA_HOST_STATUSES, INFRA_PROVIDERS } from "./schema";

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
    storageGb: z.number().int(),
  })
  .openapi("InfraHostTotals");

const modelSummaryFields = {
  id: z.string(),
  name: z.string(),
  provider: z.enum(INFRA_PROVIDERS),
  family: z.string().nullable(),
  ramGb: z.number().int(),
  vcpu: z.number().int(),
  storageGb: z.number().int(),
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
    storageGb: z.number().int(),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
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
