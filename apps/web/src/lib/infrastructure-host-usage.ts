// Peak use of the hosts as the task VM editor projects it. It mirrors the
// capacity engine (apps/api/src/infrastructure/capacity.ts): usable RAM is the
// model RAM minus the hypervisor reserve, vCPU and local disk are the model
// values. VMs never leave a host, so the binding number is the total of every
// VM placed on the host, whatever the date or the task.

export type HostUsageInput = {
  id: string;
  model: {
    ramGb: number;
    vcpu: number;
    storageGb: number;
    hypervisorReservePercent: number;
  };
  totals: { vcpu: number; ramGb: number; localStorageGb: number };
};

export type SavedVmUsage = {
  hostId: string | null;
  vcpu: number;
  ramGb: number;
  localStorageGb: number;
};

// An editor row; the numbers are the raw input strings.
export type EditorRowUsage = {
  key: string;
  hostId: string | null;
  vcpu: string;
  ramGb: string;
  localStorageGb: string;
};

export type ResourceUsage = { used: number; capacity: number };

export type HostUsage = {
  ram: ResourceUsage;
  vcpu: ResourceUsage;
  localStorage: ResourceUsage;
};

export type FreeCapacity = { ram: number; vcpu: number; localStorage: number };

type Amounts = { ram: number; vcpu: number; localStorage: number };

// Invalid, empty or negative input counts as 0.
function parseAmount(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowAmounts(row: EditorRowUsage): Amounts {
  return {
    ram: parseAmount(row.ramGb),
    vcpu: parseAmount(row.vcpu),
    localStorage: parseAmount(row.localStorageGb),
  };
}

export function hostCapacity(host: HostUsageInput): Amounts {
  const { model } = host;
  return {
    ram: Math.floor(
      (model.ramGb * (100 - model.hypervisorReservePercent)) / 100,
    ),
    vcpu: model.vcpu,
    localStorage: model.storageGb,
  };
}

// What the host carries without the saved VMs of this task.
function committedByOthers(
  host: HostUsageInput,
  savedVms: SavedVmUsage[],
): Amounts {
  const committed: Amounts = {
    ram: host.totals.ramGb,
    vcpu: host.totals.vcpu,
    localStorage: host.totals.localStorageGb,
  };
  for (const vm of savedVms) {
    if (vm.hostId !== host.id) continue;
    committed.ram -= vm.ramGb;
    committed.vcpu -= vm.vcpu;
    committed.localStorage -= vm.localStorageGb;
  }
  return {
    ram: Math.max(0, committed.ram),
    vcpu: Math.max(0, committed.vcpu),
    localStorage: Math.max(0, committed.localStorage),
  };
}

function sumRows(
  rows: EditorRowUsage[],
  hostId: string,
  excludeKey?: string,
): Amounts {
  const sum: Amounts = { ram: 0, vcpu: 0, localStorage: 0 };
  for (const row of rows) {
    if (row.hostId !== hostId || row.key === excludeKey) continue;
    const amounts = rowAmounts(row);
    sum.ram += amounts.ram;
    sum.vcpu += amounts.vcpu;
    sum.localStorage += amounts.localStorage;
  }
  return sum;
}

// Use per host: committed by others plus every current editor row (unsaved
// edits included).
export function computeHostUsage(
  hosts: HostUsageInput[],
  savedVms: SavedVmUsage[],
  rows: EditorRowUsage[],
): Map<string, HostUsage> {
  const result = new Map<string, HostUsage>();
  for (const host of hosts) {
    const capacity = hostCapacity(host);
    const others = committedByOthers(host, savedVms);
    const editing = sumRows(rows, host.id);
    result.set(host.id, {
      ram: { used: others.ram + editing.ram, capacity: capacity.ram },
      vcpu: { used: others.vcpu + editing.vcpu, capacity: capacity.vcpu },
      localStorage: {
        used: others.localStorage + editing.localStorage,
        capacity: capacity.localStorage,
      },
    });
  }
  return result;
}

// Capacity a row sees on a host: capacity minus what others and the other
// editor rows on that host use. Negative when the host is already over.
export function freeCapacityForRow(
  host: HostUsageInput,
  savedVms: SavedVmUsage[],
  rows: EditorRowUsage[],
  rowKey: string,
): FreeCapacity {
  const capacity = hostCapacity(host);
  const others = committedByOthers(host, savedVms);
  const editing = sumRows(rows, host.id, rowKey);
  return {
    ram: capacity.ram - others.ram - editing.ram,
    vcpu: capacity.vcpu - others.vcpu - editing.vcpu,
    localStorage:
      capacity.localStorage - others.localStorage - editing.localStorage,
  };
}

// Percent of capacity; null without capacity.
export function usagePercent({ used, capacity }: ResourceUsage): number | null {
  return capacity > 0 ? (used / capacity) * 100 : null;
}

export function isOverCapacity(usage: HostUsage): boolean {
  return (
    usage.ram.used > usage.ram.capacity ||
    usage.vcpu.used > usage.vcpu.capacity ||
    usage.localStorage.used > usage.localStorage.capacity
  );
}
