import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });
export const modelParam = projectIdParam.extend({ modelId: z.string() });
export const hostParam = projectIdParam.extend({ hostId: z.string() });
export const taskIdParam = z.object({ taskId: z.string() });
export const workspaceIdParam = z.object({ workspaceId: z.string() });
export const workspaceClusterParam = workspaceIdParam.extend({
  clusterId: z.string(),
});
export const workspaceCapacityParam = workspaceClusterParam.extend({
  entryId: z.string(),
});
export const workspaceHostParam = workspaceIdParam.extend({
  hostId: z.string(),
});

export const INFRA_PROVIDERS = ["ovh", "azure", "other"] as const;
export const INFRA_HOST_STATUSES = ["planned", "ordered", "installed"] as const;
export const INFRA_CLUSTER_KINDS = ["self_managed", "managed_service"] as const;
export const MAX_VMS_PER_TASK = 200;

// A region code is trimmed and upper-cased, 1 to 16 characters of A-Z, 0-9
// and "-" (for example `GRA`, `PAR`, `WEST-EU`).
export const regionCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(16)
  .regex(/^[A-Z0-9-]+$/, "Region codes use A-Z, 0-9 and -")
  .openapi({ example: "GRA" });

const regionList = z
  .array(regionCode)
  .min(1)
  .max(20)
  .refine((regions) => new Set(regions).size === regions.length, {
    message: "Regions must be unique",
  })
  .describe("Allowed region codes, 1 to 20 unique entries");

const modelFields = {
  name: z.string().trim().min(1).max(200),
  provider: z.enum(INFRA_PROVIDERS),
  family: z.string().trim().max(200).nullable(),
  ramGb: z.number().int().min(1).max(1_000_000),
  vcpu: z.number().int().min(1).max(1_000_000),
  storageGb: z.number().int().min(0).max(100_000_000),
  regions: regionList,
  leadTimeDays: z.number().int().min(0).max(3650),
  hypervisorReservePercent: z.number().int().min(0).max(90),
};

// Availability zone codes follow the region code format.
export const zoneCode = regionCode;

const zoneList = z
  .array(zoneCode)
  .max(20)
  .refine((zones) => new Set(zones).size === zones.length, {
    message: "Zones must be unique",
  });

export const createRegionBody = z.object({
  code: regionCode,
  name: z.string().trim().min(1).max(200),
  zones: zoneList.default([]),
});

export const updateRegionBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  zones: zoneList.optional(),
  position: z.number().int().min(0).max(100_000).optional(),
});

export const workspaceRegionParam = workspaceIdParam.extend({
  regionId: z.string(),
});

export const createModelBody = z.object({
  ...modelFields,
  family: modelFields.family.optional(),
  leadTimeDays: modelFields.leadTimeDays.default(0),
  hypervisorReservePercent: modelFields.hypervisorReservePercent.default(5),
});

export const updateModelBody = z.object(modelFields).partial();

export const createHostBody = z
  .object({
    modelId: z.string(),
    region: regionCode,
    label: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(50).default(1),
    zones: z
      .array(zoneCode)
      .min(1)
      .max(20)
      .refine((zones) => new Set(zones).size === zones.length, {
        message: "Zones must be unique",
      })
      .optional(),
  })
  .refine((body) => body.label === undefined || body.quantity === 1, {
    message: "A custom label is allowed only with quantity 1",
    path: ["label"],
  });

export const updateHostBody = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  region: regionCode.optional(),
  zone: zoneCode.nullable().optional(),
});

export const vmItem = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(200),
  vcpu: z.number().int().min(0).max(1_000_000),
  ramGb: z.number().int().min(0).max(1_000_000),
  localStorageGb: z.number().int().min(0).max(100_000_000),
  cephStorageGb: z.number().int().min(0).max(100_000_000).default(0),
  storageClusterId: z.string().nullable().default(null),
  hostId: z.string().nullable(),
});

export const replaceVmsBody = z.object({
  vms: z.array(vmItem).max(MAX_VMS_PER_TASK),
});

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Not a valid calendar date");

export const setHostStatusBody = z.object({
  status: z.enum(INFRA_HOST_STATUSES),
  availableFrom: dateOnly.nullable().optional(),
  hostname: z.string().trim().max(255).nullable().optional(),
});

const clusterFields = {
  name: z.string().trim().min(1).max(200),
  region: regionCode,
  kind: z.enum(INFRA_CLUSTER_KINDS),
  ecDataChunks: z.number().int().min(1).max(1000).nullable(),
  ecCodingChunks: z.number().int().min(1).max(1000).nullable(),
  fillThresholdPercent: z.number().int().min(1).max(100),
  leadTimeDays: z.number().int().min(0).max(3650),
};

const ecConsistent = (v: {
  kind?: string;
  ecDataChunks?: number | null;
  ecCodingChunks?: number | null;
}) =>
  v.kind === "self_managed"
    ? v.ecDataChunks != null && v.ecCodingChunks != null
    : v.kind === "managed_service"
      ? v.ecDataChunks == null && v.ecCodingChunks == null
      : true;

const ecMessage =
  "A self_managed cluster needs ecDataChunks and ecCodingChunks; a managed_service cluster has neither";

export const createClusterBody = z
  .object({
    ...clusterFields,
    ecDataChunks: clusterFields.ecDataChunks.optional(),
    ecCodingChunks: clusterFields.ecCodingChunks.optional(),
    fillThresholdPercent: clusterFields.fillThresholdPercent.default(80),
    leadTimeDays: clusterFields.leadTimeDays.default(0),
  })
  .refine(ecConsistent, { message: ecMessage });

// Partial update. The consistency of the merged cluster is checked by the
// controller (a kind switch also needs the stored values).
export const updateClusterBody = z.object(clusterFields).partial();

const capacityGb = z.number().int().min(1).max(1_000_000_000);

export const createCapacityBody = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  modelName: z.string().trim().min(1).max(200).nullable().optional(),
  capacityGb,
});

export const updateCapacityBody = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  modelName: z.string().trim().min(1).max(200).nullable().optional(),
  capacityGb: capacityGb.optional(),
  status: z.enum(INFRA_HOST_STATUSES).optional(),
  availableFrom: dateOnly.nullable().optional(),
  hostname: z.string().trim().max(255).nullable().optional(),
});
