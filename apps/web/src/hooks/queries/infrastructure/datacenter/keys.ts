export const datacenterCapacityKey = (workspaceId: string | undefined) =>
  ["infrastructure", "workspace", workspaceId, "capacity"] as const;

export const datacenterHostsKey = (workspaceId: string | undefined) =>
  ["infrastructure", "workspace", workspaceId, "hosts"] as const;

export const datacenterClustersKey = (workspaceId: string | undefined) =>
  ["infrastructure", "workspace", workspaceId, "storage-clusters"] as const;

export const datacenterRegionsKey = (workspaceId: string | undefined) =>
  ["infrastructure", "workspace", workspaceId, "regions"] as const;

export const DATACENTER_STALE_TIME = 30 * 1000;
