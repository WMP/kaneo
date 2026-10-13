// Capacity engine of the infrastructure module (see
// docs/plans/infrastructure-capacity.md, "Capacity engine and order plan").
//
// Pure functions: plain data in, plain data out, no database and no clock.
// Dates are date-only strings (YYYY-MM-DD) compared lexicographically; `today`
// is a parameter so results are deterministic. VMs never leave their host, so
// use is a step function that rises on VM start dates.
//
// Thresholds: a resource is "over 80" when use >= 80 percent of its capacity
// and "over 100" when use is strictly above its capacity. A resource with no
// capacity and some use counts as over 100.

export type Status = "planned" | "ordered" | "installed";
export type ClusterKind = "self_managed" | "managed_service";

export type CapHost = {
  id: string;
  label: string;
  projectId: string;
  projectName: string;
  region: string;
  zone: string | null;
  status: Status;
  availableFrom: string | null;
  model: {
    id: string;
    name: string;
    provider: string;
    family: string | null;
    ramGb: number;
    vcpu: number;
    storageGb: number;
    leadTimeDays: number;
    hypervisorReservePercent: number;
  };
};

export type CapVm = {
  id: string;
  name: string;
  taskId: string;
  projectId: string;
  hostId: string | null;
  storageClusterId: string | null;
  vcpu: number;
  ramGb: number;
  localStorageGb: number;
  cephStorageGb: number;
  // The task's start date, else its due date, as a UTC calendar date.
  startDate: string | null;
};

export type CapEntry = {
  id: string;
  label: string;
  modelName: string | null;
  capacityGb: number;
  status: Status;
  availableFrom: string | null;
  // ISO timestamp; only compared as a string to find the latest entry.
  createdAt: string;
};

export type CapCluster = {
  id: string;
  name: string;
  region: string;
  kind: ClusterKind;
  ecDataChunks: number | null;
  ecCodingChunks: number | null;
  fillThresholdPercent: number;
  leadTimeDays: number;
  entries: CapEntry[];
};

export type WarningType =
  | "HOST_NOT_READY"
  | "ORDER_LATE"
  | "OVER_100"
  | "OVER_80"
  | "VM_UNPLACED"
  | "VM_UNSCHEDULED"
  | "CLUSTER_NOT_READY"
  | "CLUSTER_SHORTFALL";

export type CapWarning = {
  type: WarningType;
  severity: "error" | "warning" | "info";
  hostId?: string;
  clusterId?: string;
  vmId?: string;
  taskId?: string;
  date?: string;
};

export type HostStep = {
  date: string;
  ramGb: number;
  vcpu: number;
  localStorageGb: number;
  ramPercent: number | null;
  vcpuPercent: number | null;
  localStoragePercent: number | null;
};

export type HostResult = {
  hostId: string;
  usableRamGb: number;
  vcpu: number;
  localStorageGb: number;
  needDate: string | null;
  orderByDate: string | null;
  steps: HostStep[];
  peakRamPercent: number | null;
  firstOver80Date: string | null;
  firstOver100Date: string | null;
};

export type ClusterStep = {
  date: string;
  usedCephGb: number;
  usableGb: number;
  percent: number | null;
};

export type ClusterSuggestion = {
  kind: "nodes" | "service";
  shortfallGb: number;
  // self_managed: nodes of the size of the latest entry. Null without one.
  nodes: number | null;
  nodeCapacityGb: number | null;
  modelName: string | null;
  // managed_service: GB to buy.
  buyGb: number | null;
  needDate: string | null;
  orderByDate: string | null;
};

export type ClusterResult = {
  clusterId: string;
  needDate: string | null;
  steps: ClusterStep[];
  firstOver80Date: string | null;
  firstOver100Date: string | null;
  // Usable GB counting every entry as delivered (planned, ordered, installed).
  usableAllGb: number;
  shortfallGb: number;
  // First day the capacity that is ordered or installed (counted as delivered)
  // no longer covers the use: when planned entries become necessary.
  plannedNeedDate: string | null;
  suggestion: ClusterSuggestion | null;
};

export type OrderPlanRow = {
  type: "host" | "storage_node" | "storage_service";
  orderByDate: string | null;
  needDate: string | null;
  provider: string | null;
  region: string;
  zone: string | null;
  model: string | null;
  family: string | null;
  ramGb: number | null;
  vcpu: number | null;
  storageGb: number | null;
  quantity: number;
  capacityGb: number | null;
  projectId: string | null;
  projectName: string | null;
  clusterId: string | null;
  clusterName: string | null;
  labels: string[];
  status: "planned" | "suggested";
  late: boolean;
};

export type CapacityResult = {
  hosts: HostResult[];
  clusters: ClusterResult[];
  warnings: CapWarning[];
  orderPlan: OrderPlanRow[];
  unplacedVms: CapVm[];
  unscheduledVms: CapVm[];
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const percentOf = (used: number, capacity: number) =>
  capacity > 0 ? round1((used / capacity) * 100) : null;
// used >= 80 percent of capacity (and some use), without float rounding.
const reaches80 = (used: number, capacity: number) =>
  used > 0 && used * 100 >= 80 * capacity;
const exceeds = (used: number, capacity: number) => used > capacity;

// A host is available from `availableFrom` when ordered or installed; a planned
// host is never available. An installed host without a date is always available.
function availableOn(
  host: Pick<CapHost, "status" | "availableFrom">,
  date: string,
) {
  if (host.status === "planned") return false;
  if (host.availableFrom == null) return host.status === "installed";
  return host.availableFrom <= date;
}

function entryAvailableOn(entry: CapEntry, date: string) {
  if (entry.status === "planned") return false;
  if (entry.availableFrom == null) return entry.status === "installed";
  return entry.availableFrom <= date;
}

export function usableRamGb(ramGb: number, reservePercent: number) {
  return Math.floor((ramGb * (100 - reservePercent)) / 100);
}

export function clusterUsableGb(
  cluster: Pick<
    CapCluster,
    "kind" | "ecDataChunks" | "ecCodingChunks" | "fillThresholdPercent"
  >,
  rawGb: number,
) {
  const k = cluster.ecDataChunks ?? 1;
  const m = cluster.ecCodingChunks ?? 0;
  const ec = cluster.kind === "self_managed" ? { k, total: k + m } : null;
  const numerator = rawGb * (ec ? ec.k : 1) * cluster.fillThresholdPercent;
  return Math.floor(numerator / ((ec ? ec.total : 1) * 100));
}

function sortedDistinct(dates: Iterable<string>) {
  return [...new Set(dates)].sort();
}

export function computeHostResult(host: CapHost, vms: CapVm[]): HostResult {
  const own = vms.filter((v) => v.hostId === host.id && v.startDate != null);
  const capRam = usableRamGb(
    host.model.ramGb,
    host.model.hypervisorReservePercent,
  );
  const capCpu = host.model.vcpu;
  const capDisk = host.model.storageGb;
  const steps: HostStep[] = [];
  let firstOver80: string | null = null;
  let firstOver100: string | null = null;
  let peak: number | null = null;
  for (const date of sortedDistinct(own.map((v) => v.startDate as string))) {
    const used = own.filter((v) => (v.startDate as string) <= date);
    const ramGb = used.reduce((a, v) => a + v.ramGb, 0);
    const vcpu = used.reduce((a, v) => a + v.vcpu, 0);
    const localStorageGb = used.reduce((a, v) => a + v.localStorageGb, 0);
    const step: HostStep = {
      date,
      ramGb,
      vcpu,
      localStorageGb,
      ramPercent: percentOf(ramGb, capRam),
      vcpuPercent: percentOf(vcpu, capCpu),
      localStoragePercent: percentOf(localStorageGb, capDisk),
    };
    steps.push(step);
    if (step.ramPercent != null) {
      peak = Math.max(peak ?? 0, step.ramPercent);
    }
    const pairs: [number, number][] = [
      [ramGb, capRam],
      [vcpu, capCpu],
      [localStorageGb, capDisk],
    ];
    if (!firstOver80 && pairs.some(([u, c]) => reaches80(u, c))) {
      firstOver80 = date;
    }
    if (!firstOver100 && pairs.some(([u, c]) => exceeds(u, c))) {
      firstOver100 = date;
    }
  }
  const needDate = steps[0]?.date ?? null;
  return {
    hostId: host.id,
    usableRamGb: capRam,
    vcpu: capCpu,
    localStorageGb: capDisk,
    needDate,
    orderByDate: needDate ? addDays(needDate, -host.model.leadTimeDays) : null,
    steps,
    peakRamPercent: peak,
    firstOver80Date: firstOver80,
    firstOver100Date: firstOver100,
  };
}

export function computeClusterResult(
  cluster: CapCluster,
  vms: CapVm[],
): ClusterResult {
  const own = vms.filter(
    (v) =>
      v.storageClusterId === cluster.id &&
      v.cephStorageGb > 0 &&
      v.startDate != null,
  );
  const rawAvailable = (date: string) =>
    cluster.entries
      .filter((e) => entryAvailableOn(e, date))
      .reduce((a, e) => a + e.capacityGb, 0);
  const rawAll = cluster.entries.reduce((a, e) => a + e.capacityGb, 0);
  // Ordered and installed entries counted as delivered.
  const rawDelivered = cluster.entries
    .filter((e) => e.status !== "planned")
    .reduce((a, e) => a + e.capacityGb, 0);
  const usableAllGb = clusterUsableGb(cluster, rawAll);
  const usableDelivered = clusterUsableGb(cluster, rawDelivered);

  const dates = sortedDistinct([
    ...own.map((v) => v.startDate as string),
    ...cluster.entries.flatMap((e) =>
      e.status !== "planned" && e.availableFrom ? [e.availableFrom] : [],
    ),
  ]);
  const steps: ClusterStep[] = [];
  let firstOver80: string | null = null;
  let firstOver100: string | null = null;
  let plannedNeedDate: string | null = null;
  let allExceededDate: string | null = null;
  for (const date of dates) {
    const usedCephGb = own
      .filter((v) => (v.startDate as string) <= date)
      .reduce((a, v) => a + v.cephStorageGb, 0);
    const usableGb = clusterUsableGb(cluster, rawAvailable(date));
    steps.push({
      date,
      usedCephGb,
      usableGb,
      percent: percentOf(usedCephGb, usableGb),
    });
    if (!firstOver80 && reaches80(usedCephGb, usableGb)) firstOver80 = date;
    if (!firstOver100 && exceeds(usedCephGb, usableGb)) firstOver100 = date;
    if (!plannedNeedDate && exceeds(usedCephGb, usableDelivered)) {
      plannedNeedDate = date;
    }
    if (!allExceededDate && exceeds(usedCephGb, usableAllGb)) {
      allExceededDate = date;
    }
  }
  const finalUsed = own.reduce((a, v) => a + v.cephStorageGb, 0);
  const shortfallGb = Math.max(0, finalUsed - usableAllGb);
  const needDate = own.length
    ? (sortedDistinct(own.map((v) => v.startDate as string))[0] ?? null)
    : null;

  let suggestion: ClusterSuggestion | null = null;
  if (shortfallGb > 0) {
    const orderByDate = allExceededDate
      ? addDays(allExceededDate, -cluster.leadTimeDays)
      : null;
    if (cluster.kind === "self_managed") {
      const latest = [...cluster.entries].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )[0];
      const k = cluster.ecDataChunks ?? 1;
      const total = k + (cluster.ecCodingChunks ?? 0);
      suggestion = {
        kind: "nodes",
        shortfallGb,
        nodes: latest
          ? Math.ceil(
              (shortfallGb * total * 100) /
                (latest.capacityGb * k * cluster.fillThresholdPercent),
            )
          : null,
        nodeCapacityGb: latest?.capacityGb ?? null,
        modelName: latest?.modelName ?? null,
        buyGb: null,
        needDate: allExceededDate,
        orderByDate,
      };
    } else {
      suggestion = {
        kind: "service",
        shortfallGb,
        nodes: null,
        nodeCapacityGb: null,
        modelName: null,
        buyGb: Math.ceil((shortfallGb * 100) / cluster.fillThresholdPercent),
        needDate: allExceededDate,
        orderByDate,
      };
    }
  }

  return {
    clusterId: cluster.id,
    needDate,
    steps,
    firstOver80Date: firstOver80,
    firstOver100Date: firstOver100,
    usableAllGb,
    shortfallGb,
    plannedNeedDate,
    suggestion,
  };
}

const isLate = (orderBy: string | null, today: string) =>
  orderBy != null && orderBy < today;

function compareNullsLast(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

export function buildOrderPlan(input: {
  hosts: CapHost[];
  hostResults: HostResult[];
  clusters: CapCluster[];
  clusterResults: ClusterResult[];
  today: string;
}): OrderPlanRow[] {
  const { today } = input;
  const rows: OrderPlanRow[] = [];

  const resultOf = new Map(input.hostResults.map((r) => [r.hostId, r]));
  const grouped = new Map<string, OrderPlanRow>();
  for (const host of input.hosts) {
    if (host.status !== "planned") continue;
    const result = resultOf.get(host.id);
    const orderByDate = result?.orderByDate ?? null;
    const needDate = result?.needDate ?? null;
    const key = JSON.stringify([
      orderByDate,
      needDate,
      host.region,
      host.zone,
      host.model.name,
      host.model.ramGb,
      host.projectId,
    ]);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.labels.push(host.label);
      continue;
    }
    grouped.set(key, {
      type: "host",
      orderByDate,
      needDate,
      provider: host.model.provider,
      region: host.region,
      zone: host.zone,
      model: host.model.name,
      family: host.model.family,
      ramGb: host.model.ramGb,
      vcpu: host.model.vcpu,
      storageGb: host.model.storageGb,
      quantity: 1,
      capacityGb: null,
      projectId: host.projectId,
      projectName: host.projectName,
      clusterId: null,
      clusterName: null,
      labels: [host.label],
      status: "planned",
      late: isLate(orderByDate, today),
    });
  }
  rows.push(...grouped.values());

  const clusterResultOf = new Map(
    input.clusterResults.map((r) => [r.clusterId, r]),
  );
  for (const cluster of input.clusters) {
    const result = clusterResultOf.get(cluster.id);
    const type =
      cluster.kind === "self_managed" ? "storage_node" : "storage_service";
    const base = {
      type,
      provider: null,
      region: cluster.region,
      zone: null,
      family: null,
      ramGb: null,
      vcpu: null,
      storageGb: null,
      projectId: null,
      projectName: null,
      clusterId: cluster.id,
      clusterName: cluster.name,
    } as const;
    // A planned entry is needed when delivered capacity stops covering the use.
    const entryNeed = result?.plannedNeedDate ?? null;
    const entryOrderBy = entryNeed
      ? addDays(entryNeed, -cluster.leadTimeDays)
      : null;
    for (const entry of cluster.entries) {
      if (entry.status !== "planned") continue;
      rows.push({
        ...base,
        orderByDate: entryOrderBy,
        needDate: entryNeed,
        model: entry.modelName,
        quantity: 1,
        capacityGb: entry.capacityGb,
        labels: [entry.label],
        status: "planned",
        late: isLate(entryOrderBy, today),
      });
    }
    const s = result?.suggestion;
    if (s) {
      rows.push({
        ...base,
        orderByDate: s.orderByDate,
        needDate: s.needDate,
        model: s.modelName,
        quantity: s.kind === "nodes" ? (s.nodes ?? 1) : 1,
        capacityGb: s.kind === "nodes" ? s.nodeCapacityGb : s.buyGb,
        labels: [`${cluster.name} (suggested)`],
        status: "suggested",
        late: isLate(s.orderByDate, today),
      });
    }
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        compareNullsLast(a.row.orderByDate, b.row.orderByDate) ||
        (a.row.region < b.row.region
          ? -1
          : a.row.region > b.row.region
            ? 1
            : 0) ||
        compareNullsLast(a.row.model, b.row.model) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

export function computeCapacity(input: {
  hosts: CapHost[];
  vms: CapVm[];
  clusters: CapCluster[];
  today: string;
}): CapacityResult {
  const { hosts, vms, clusters, today } = input;
  const hostResults = hosts.map((h) => computeHostResult(h, vms));
  const clusterResults = clusters.map((c) => computeClusterResult(c, vms));
  const hostById = new Map(hosts.map((h) => [h.id, h]));
  const warnings: CapWarning[] = [];

  for (const vm of vms) {
    const host = vm.hostId ? hostById.get(vm.hostId) : undefined;
    if (vm.hostId == null) {
      warnings.push({
        type: "VM_UNPLACED",
        severity: "warning",
        vmId: vm.id,
        taskId: vm.taskId,
      });
    }
    if (vm.startDate == null) {
      warnings.push({
        type: "VM_UNSCHEDULED",
        severity: "info",
        vmId: vm.id,
        taskId: vm.taskId,
        ...(host ? { hostId: host.id } : {}),
      });
    } else if (host && !availableOn(host, vm.startDate)) {
      warnings.push({
        type: "HOST_NOT_READY",
        severity: "error",
        hostId: host.id,
        vmId: vm.id,
        taskId: vm.taskId,
        date: vm.startDate,
      });
    }
  }

  for (const result of hostResults) {
    const host = hostById.get(result.hostId) as CapHost;
    if (host.status === "planned" && isLate(result.orderByDate, today)) {
      warnings.push({
        type: "ORDER_LATE",
        severity: "error",
        hostId: host.id,
        date: result.orderByDate as string,
      });
    }
    // Only the highest level is reported.
    if (result.firstOver100Date) {
      warnings.push({
        type: "OVER_100",
        severity: "error",
        hostId: host.id,
        date: result.firstOver100Date,
      });
    } else if (result.firstOver80Date) {
      warnings.push({
        type: "OVER_80",
        severity: "warning",
        hostId: host.id,
        date: result.firstOver80Date,
      });
    }
  }

  const planRows = buildOrderPlan({
    hosts,
    hostResults,
    clusters,
    clusterResults,
    today,
  });

  for (const cluster of clusters) {
    const result = clusterResults.find(
      (r) => r.clusterId === cluster.id,
    ) as ClusterResult;
    // Capacity exists on paper (planned entries counted) but is not delivered
    // yet when VMs start.
    const notReady = result.steps.find(
      (s) => s.usedCephGb > s.usableGb && s.usedCephGb <= result.usableAllGb,
    );
    if (notReady) {
      warnings.push({
        type: "CLUSTER_NOT_READY",
        severity: "error",
        clusterId: cluster.id,
        date: notReady.date,
      });
    }
    if (result.shortfallGb > 0) {
      warnings.push({
        type: "CLUSTER_SHORTFALL",
        severity: "error",
        clusterId: cluster.id,
        ...(result.suggestion?.needDate
          ? { date: result.suggestion.needDate }
          : {}),
      });
    }
    const late = planRows.find(
      (r) => r.clusterId === cluster.id && r.late && r.orderByDate,
    );
    if (late) {
      warnings.push({
        type: "ORDER_LATE",
        severity: "error",
        clusterId: cluster.id,
        date: late.orderByDate as string,
      });
    }
    if (!result.firstOver100Date && result.firstOver80Date) {
      warnings.push({
        type: "OVER_80",
        severity: "warning",
        clusterId: cluster.id,
        date: result.firstOver80Date,
      });
    }
    // Over 100 on a cluster is reported as CLUSTER_NOT_READY (the capacity is
    // not delivered yet) or CLUSTER_SHORTFALL (there is not enough capacity).
  }

  return {
    hosts: hostResults,
    clusters: clusterResults,
    warnings,
    orderPlan: planRows,
    unplacedVms: vms.filter((v) => v.hostId == null),
    unscheduledVms: vms.filter((v) => v.startDate == null),
  };
}
