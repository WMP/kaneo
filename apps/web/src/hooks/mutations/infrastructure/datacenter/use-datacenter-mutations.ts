import { useMutation, useQueryClient } from "@tanstack/react-query";
import createRegion from "@/fetchers/infrastructure/datacenter/create-region";
import createStorageCapacity from "@/fetchers/infrastructure/datacenter/create-storage-capacity";
import createStorageCluster from "@/fetchers/infrastructure/datacenter/create-storage-cluster";
import deleteRegion from "@/fetchers/infrastructure/datacenter/delete-region";
import deleteStorageCapacity from "@/fetchers/infrastructure/datacenter/delete-storage-capacity";
import deleteStorageCluster from "@/fetchers/infrastructure/datacenter/delete-storage-cluster";
import downloadOrderPlan from "@/fetchers/infrastructure/datacenter/download-order-plan";
import setHostStatus from "@/fetchers/infrastructure/datacenter/set-host-status";
import updateRegion from "@/fetchers/infrastructure/datacenter/update-region";
import updateStorageCapacity from "@/fetchers/infrastructure/datacenter/update-storage-capacity";
import updateStorageCluster from "@/fetchers/infrastructure/datacenter/update-storage-cluster";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";

// Every infrastructure mutation refreshes the whole infrastructure cache: a
// host, capacity or region change moves the day-by-day capacity, the order
// plan, the warnings and the totals together, and the project views read the
// same data.
export function useSetHostStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setHostStatus,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useCreateStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStorageCluster,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useUpdateStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateStorageCluster,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useDeleteStorageCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStorageCluster,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useCreateStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStorageCapacity,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useUpdateStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateStorageCapacity,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useDeleteStorageCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStorageCapacity,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useCreateRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRegion,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useUpdateRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRegion,
    onSettled: () => invalidateInfrastructure(queryClient),
  });
}

export function useDeleteRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRegion,
    onSettled: () => invalidateInfrastructure(queryClient),
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
