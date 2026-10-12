import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import createStorageCapacity from "@/fetchers/infrastructure/datacenter/create-storage-capacity";
import createStorageCluster from "@/fetchers/infrastructure/datacenter/create-storage-cluster";
import deleteStorageCapacity from "@/fetchers/infrastructure/datacenter/delete-storage-capacity";
import deleteStorageCluster from "@/fetchers/infrastructure/datacenter/delete-storage-cluster";
import downloadOrderPlan from "@/fetchers/infrastructure/datacenter/download-order-plan";
import setHostStatus from "@/fetchers/infrastructure/datacenter/set-host-status";
import updateStorageCapacity from "@/fetchers/infrastructure/datacenter/update-storage-capacity";
import updateStorageCluster from "@/fetchers/infrastructure/datacenter/update-storage-cluster";
import {
  datacenterCapacityKey,
  datacenterClustersKey,
  datacenterHostsKey,
} from "@/hooks/queries/infrastructure/datacenter/keys";

// A host or capacity change moves the day-by-day capacity, the order plan, the
// warnings and the cluster totals together, so every mutation refreshes all of
// the workspace's datacenter data.
function invalidateDatacenter(queryClient: QueryClient, workspaceId: string) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: datacenterCapacityKey(workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: datacenterHostsKey(workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: datacenterClustersKey(workspaceId),
    }),
  ]);
}

export function useSetHostStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setHostStatus,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useCreateStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStorageCluster,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useUpdateStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateStorageCluster,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useDeleteStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStorageCluster,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useCreateStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStorageCapacity,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useUpdateStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateStorageCapacity,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

export function useDeleteStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStorageCapacity,
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateDatacenter(queryClient, workspaceId),
  });
}

// Triggers a browser download from the XLSX response. Nothing changes on the
// server, so no cache is invalidated.
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously after click() can abort the download in some
  // browsers before they start reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useDownloadOrderPlan() {
  return useMutation({
    mutationFn: (workspaceId: string) => downloadOrderPlan(workspaceId),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
  });
}
