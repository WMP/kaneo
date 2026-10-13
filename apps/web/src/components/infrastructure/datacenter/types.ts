import type getRegions from "@/fetchers/infrastructure/datacenter/get-regions";
import type getStorageClusters from "@/fetchers/infrastructure/datacenter/get-storage-clusters";
import type getWorkspaceCapacity from "@/fetchers/infrastructure/datacenter/get-workspace-capacity";
import type getWorkspaceHosts from "@/fetchers/infrastructure/datacenter/get-workspace-hosts";

export type WorkspaceCapacity = Awaited<
  ReturnType<typeof getWorkspaceCapacity>
>;
export type OrderPlanRow = WorkspaceCapacity["orderPlan"][number];
export type CapacityWarning = WorkspaceCapacity["warnings"][number];
export type HostCapacity = WorkspaceCapacity["hosts"][number];
export type ClusterCapacity = WorkspaceCapacity["clusters"][number];

export type DatacenterHost = Awaited<
  ReturnType<typeof getWorkspaceHosts>
>[number];

export type StorageCluster = Awaited<
  ReturnType<typeof getStorageClusters>
>[number];
export type StorageCapacityEntry = StorageCluster["capacity"][number];

export type CatalogRegion = Awaited<ReturnType<typeof getRegions>>[number];
