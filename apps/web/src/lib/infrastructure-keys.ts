// Query keys of the infrastructure capacity feature. Everything of one project
// lives under ["infrastructure", "project", projectId].
export const infrastructureKeys = {
  models: (projectId: string) =>
    ["infrastructure", "project", projectId, "models"] as const,
  hosts: (projectId: string) =>
    ["infrastructure", "project", projectId, "hosts"] as const,
  capacity: (projectId: string) =>
    ["infrastructure", "project", projectId, "capacity"] as const,
  storageClusters: (projectId: string) =>
    ["infrastructure", "project", projectId, "storage-clusters"] as const,
  taskVms: (taskId: string) =>
    ["infrastructure", "task", taskId, "vms"] as const,
};

export const INFRASTRUCTURE_STALE_TIME = 30 * 1000;
