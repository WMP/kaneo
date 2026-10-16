import type { QueryClient } from "@tanstack/react-query";

// Query keys of the infrastructure capacity feature. Everything starts with
// "infrastructure": a project's data lives under
// ["infrastructure", "project", projectId], the datacenter's under
// ["infrastructure", "workspace", workspaceId].
export const infrastructureKeys = {
  models: (projectId: string) =>
    ["infrastructure", "project", projectId, "models"] as const,
  hosts: (projectId: string) =>
    ["infrastructure", "project", projectId, "hosts"] as const,
  capacity: (projectId: string) =>
    ["infrastructure", "project", projectId, "capacity"] as const,
  storageClusters: (projectId: string) =>
    ["infrastructure", "project", projectId, "storage-clusters"] as const,
  regions: (projectId: string) =>
    ["infrastructure", "project", projectId, "regions"] as const,
  taskVms: (taskId: string) =>
    ["infrastructure", "task", taskId, "vms"] as const,
};

export const INFRASTRUCTURE_STALE_TIME = 30 * 1000;

// The infrastructure prefix of every query key above.
export const INFRASTRUCTURE_QUERY_KEY = ["infrastructure"] as const;

// Capacity, host totals, warnings and VM lists all depend on each other and on
// the tasks (a deleted task, a moved date), so any change refreshes the whole
// feature. Only mounted queries refetch; the others refetch on their next mount
// (the infrastructure queries set refetchOnMount: "always").
export function invalidateInfrastructure(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: INFRASTRUCTURE_QUERY_KEY });
}
