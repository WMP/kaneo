import type { InfraVm } from "@/fetchers/infrastructure/get-task-vms";
import type { TaskVmInput } from "@/fetchers/infrastructure/replace-task-vms";

// A row of the editable VM table. Numbers stay strings while the user types.
export type VmRow = {
  key: string;
  id?: string;
  name: string;
  vcpu: string;
  ramGb: string;
  cephStorageGb: string;
  localStorageGb: string;
  hostId: string | null;
  storageClusterId: string | null;
};

export const NUMBER_FIELDS = [
  "vcpu",
  "ramGb",
  "cephStorageGb",
  "localStorageGb",
] as const;
export type VmNumberField = (typeof NUMBER_FIELDS)[number];

// Limits of apps/api/src/infrastructure/schema.ts (`vmItem`).
const MAX: Record<VmNumberField, number> = {
  vcpu: 1_000_000,
  ramGb: 1_000_000,
  cephStorageGb: 100_000_000,
  localStorageGb: 100_000_000,
};

export function rowsFromVms(vms: InfraVm[]): VmRow[] {
  return vms.map((vm) => ({
    key: vm.id,
    id: vm.id,
    name: vm.name,
    vcpu: String(vm.vcpu),
    ramGb: String(vm.ramGb),
    cephStorageGb: String(vm.cephStorageGb),
    localStorageGb: String(vm.localStorageGb),
    hostId: vm.hostId,
    storageClusterId: vm.storageClusterId,
  }));
}

export function newRow(key: string): VmRow {
  return {
    key,
    name: "",
    vcpu: "0",
    ramGb: "0",
    cephStorageGb: "0",
    localStorageGb: "0",
    hostId: null,
    storageClusterId: null,
  };
}

// What decides whether the list changed: the saved fields, not the row keys.
export function rowsSignature(rows: VmRow[]): string {
  return JSON.stringify(
    rows.map((row) => [
      row.id ?? null,
      row.name.trim(),
      row.vcpu.trim(),
      row.ramGb.trim(),
      row.cephStorageGb.trim(),
      row.localStorageGb.trim(),
      row.hostId,
      row.storageClusterId,
    ]),
  );
}

export type VmRowErrors = {
  name?: true;
  vcpu?: true;
  ramGb?: true;
  cephStorageGb?: true;
  localStorageGb?: true;
};

export function validateRow(row: VmRow): VmRowErrors {
  const errors: VmRowErrors = {};
  if (!row.name.trim()) errors.name = true;
  for (const field of NUMBER_FIELDS) {
    const value = row[field].trim();
    if (!/^\d+$/.test(value) || Number(value) > MAX[field]) {
      errors[field] = true;
    }
  }
  return errors;
}

export function toVmInputs(rows: VmRow[]): TaskVmInput[] {
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    name: row.name.trim(),
    vcpu: Number(row.vcpu),
    ramGb: Number(row.ramGb),
    cephStorageGb: Number(row.cephStorageGb),
    localStorageGb: Number(row.localStorageGb),
    hostId: row.hostId,
    storageClusterId: row.storageClusterId,
  }));
}
