import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });
export const modelParam = projectIdParam.extend({ modelId: z.string() });
export const hostParam = projectIdParam.extend({ hostId: z.string() });
export const taskIdParam = z.object({ taskId: z.string() });
export const workspaceIdParam = z.object({ workspaceId: z.string() });
export const workspaceHostParam = workspaceIdParam.extend({
  hostId: z.string(),
});

export const INFRA_PROVIDERS = ["ovh", "azure", "other"] as const;
export const INFRA_HOST_STATUSES = ["planned", "ordered", "installed"] as const;
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

export const createModelBody = z.object({
  ...modelFields,
  family: modelFields.family.optional(),
  leadTimeDays: modelFields.leadTimeDays.default(0),
  hypervisorReservePercent: modelFields.hypervisorReservePercent.default(5),
});

export const updateModelBody = z.object(modelFields).partial();

export const createHostBody = z.object({
  modelId: z.string(),
  region: regionCode,
  label: z.string().trim().min(1).max(200).optional(),
});

export const updateHostBody = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  region: regionCode.optional(),
});

export const vmItem = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(200),
  vcpu: z.number().int().min(0).max(1_000_000),
  ramGb: z.number().int().min(0).max(1_000_000),
  storageGb: z.number().int().min(0).max(100_000_000),
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
