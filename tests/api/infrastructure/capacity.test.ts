import { describe, expect, it } from "vitest";
import {
  addDays,
  type CapCluster,
  type CapHost,
  type CapVm,
  clusterUsableGb,
  computeCapacity,
  computeClusterResult,
  computeHostResult,
  usableRamGb,
} from "../../../apps/api/src/infrastructure/capacity";

const TODAY = "2026-10-12";

function host(
  overrides: Partial<CapHost> = {},
  model: Partial<CapHost["model"]> = {},
): CapHost {
  return {
    id: "h1",
    label: "H #1",
    projectId: "p1",
    projectName: "Project 1",
    region: "GRA",
    zone: null,
    status: "installed",
    availableFrom: "2026-01-01",
    model: {
      id: "m1",
      name: "ADVANCE-2",
      provider: "ovh",
      family: "ADVANCE",
      ramGb: 256,
      vcpu: 32,
      storageGb: 4000,
      leadTimeDays: 14,
      hypervisorReserveGb: 13,
      ...model,
    },
    ...overrides,
  };
}

let vmCounter = 0;
function vm(overrides: Partial<CapVm> = {}): CapVm {
  vmCounter += 1;
  return {
    id: `vm${vmCounter}`,
    name: `vm${vmCounter}`,
    taskId: `t${vmCounter}`,
    projectId: "p1",
    hostId: "h1",
    storageClusterId: null,
    vcpu: 1,
    ramGb: 1,
    localStorageGb: 1,
    cephStorageGb: 0,
    startDate: "2026-11-10",
    ...overrides,
  };
}

function cluster(overrides: Partial<CapCluster> = {}): CapCluster {
  return {
    id: "c1",
    name: "Ceph PAR",
    region: "PAR",
    kind: "self_managed",
    ecDataChunks: 4,
    ecCodingChunks: 2,
    fillThresholdPercent: 80,
    leadTimeDays: 30,
    entries: [],
    ...overrides,
  };
}

let entryCounter = 0;
function entry(
  overrides: Partial<CapCluster["entries"][number]> = {},
): CapCluster["entries"][number] {
  entryCounter += 1;
  return {
    id: `e${entryCounter}`,
    label: `E #${entryCounter}`,
    modelName: "STOR-1",
    capacityGb: 600,
    status: "installed",
    availableFrom: "2026-01-01",
    createdAt: `2026-01-0${(entryCounter % 9) + 1}T00:00:00.000Z`,
    ...overrides,
  };
}

describe("addDays", () => {
  it("subtracts across month and year boundaries in UTC", () => {
    expect(addDays("2026-03-01", -14)).toBe("2026-02-15");
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });
});

describe("host result", () => {
  it("never has negative usable RAM", () => {
    expect(usableRamGb(8, 8)).toBe(0);
    expect(usableRamGb(8, 20)).toBe(0);
    expect(usableRamGb(256, 8)).toBe(248);
  });

  it("applies the hypervisor reserve to RAM only", () => {
    const r = computeHostResult(host(), [
      vm({ ramGb: 100, vcpu: 8, localStorageGb: 1000 }),
    ]);
    expect(r.usableRamGb).toBe(243); // 256 - 13 GB reserve
    expect(r.vcpu).toBe(32);
    expect(r.localStorageGb).toBe(4000);
    expect(r.steps[0]).toMatchObject({
      ramPercent: 41.2,
      vcpuPercent: 25,
      localStoragePercent: 25,
    });
  });

  it("builds cumulative steps per distinct start date and ignores unscheduled VMs", () => {
    const r = computeHostResult(host(), [
      vm({ startDate: "2026-12-01", ramGb: 20 }),
      vm({ startDate: "2026-11-10", ramGb: 10 }),
      vm({ startDate: "2026-11-10", ramGb: 5 }),
      vm({ startDate: null, ramGb: 200 }),
      vm({ hostId: "other", ramGb: 200 }),
    ]);
    expect(r.steps.map((s) => [s.date, s.ramGb])).toEqual([
      ["2026-11-10", 15],
      ["2026-12-01", 35],
    ]);
    expect(r.needDate).toBe("2026-11-10");
    expect(r.orderByDate).toBe("2026-10-27");
    expect(r.peakRamPercent).toBe(14.4);
  });

  it("has no need date without scheduled VMs", () => {
    const r = computeHostResult(host(), [vm({ startDate: null })]);
    expect(r).toMatchObject({
      needDate: null,
      orderByDate: null,
      steps: [],
      peakRamPercent: null,
      firstOver80Date: null,
      firstOver100Date: null,
    });
  });

  it("uses >= 80 and > 100 on RAM, vCPU or local storage", () => {
    // usable RAM 100 (reserve 0 on a 100 GB model).
    const m = {
      ramGb: 100,
      hypervisorReserveGb: 0,
      vcpu: 10,
      storageGb: 100,
    };
    const exactly80 = computeHostResult(host({}, m), [vm({ ramGb: 80 })]);
    expect(exactly80.firstOver80Date).toBe("2026-11-10");
    expect(exactly80.firstOver100Date).toBeNull();
    const exactly100 = computeHostResult(host({}, m), [vm({ ramGb: 100 })]);
    expect(exactly100.firstOver80Date).toBe("2026-11-10");
    expect(exactly100.firstOver100Date).toBeNull();
    const over = computeHostResult(host({}, m), [vm({ ramGb: 101 })]);
    expect(over.firstOver100Date).toBe("2026-11-10");

    const cpu = computeHostResult(host({}, m), [vm({ vcpu: 9, ramGb: 1 })]);
    expect(cpu.firstOver80Date).toBe("2026-11-10");
    expect(cpu.firstOver100Date).toBeNull();
    const cpuOver = computeHostResult(host({}, m), [
      vm({ vcpu: 11, ramGb: 1 }),
    ]);
    expect(cpuOver.firstOver100Date).toBe("2026-11-10");

    const disk = computeHostResult(host({}, m), [vm({ localStorageGb: 90 })]);
    expect(disk.firstOver80Date).toBe("2026-11-10");
    const diskOver = computeHostResult(host({}, m), [
      vm({ localStorageGb: 101 }),
    ]);
    expect(diskOver.firstOver100Date).toBe("2026-11-10");
  });

  it("reports the first date a threshold is crossed", () => {
    const m = { ramGb: 100, hypervisorReserveGb: 0 };
    const r = computeHostResult(host({}, m), [
      vm({ startDate: "2026-11-01", ramGb: 50 }),
      vm({ startDate: "2026-11-05", ramGb: 40 }),
      vm({ startDate: "2026-11-09", ramGb: 20 }),
    ]);
    expect(r.firstOver80Date).toBe("2026-11-05");
    expect(r.firstOver100Date).toBe("2026-11-09");
  });
});

describe("host warnings", () => {
  const run = (hosts: CapHost[], vms: CapVm[]) =>
    computeCapacity({ hosts, vms, clusters: [], today: TODAY });

  it("never treats a planned host as available", () => {
    const r = run([host({ status: "planned", availableFrom: null })], [vm()]);
    expect(r.warnings.filter((w) => w.type === "HOST_NOT_READY")).toHaveLength(
      1,
    );
  });

  it("flags a VM that starts before an ordered host is delivered", () => {
    const h = host({ status: "ordered", availableFrom: "2026-11-20" });
    const early = vm({ startDate: "2026-11-10" });
    const late = vm({ startDate: "2026-11-20" });
    const r = run([h], [early, late]);
    const notReady = r.warnings.filter((w) => w.type === "HOST_NOT_READY");
    expect(notReady).toEqual([
      {
        type: "HOST_NOT_READY",
        severity: "error",
        hostId: "h1",
        vmId: early.id,
        taskId: early.taskId,
        date: "2026-11-10",
      },
    ]);
  });

  it("does not flag an installed host that is available at the start", () => {
    expect(run([host()], [vm()]).warnings).toEqual([]);
  });

  it("flags a late order only for a planned host", () => {
    const planned = host({ status: "planned", availableFrom: null });
    // need 2026-10-20, lead 14 => order by 2026-10-06 < today
    const r = run([planned], [vm({ startDate: "2026-10-20" })]);
    expect(r.warnings).toContainEqual({
      type: "ORDER_LATE",
      severity: "error",
      hostId: "h1",
      date: "2026-10-06",
    });
    const ordered = run(
      [host({ status: "ordered", availableFrom: "2026-10-01" })],
      [vm({ startDate: "2026-10-20" })],
    );
    expect(ordered.warnings.some((w) => w.type === "ORDER_LATE")).toBe(false);
    const fine = run([planned], [vm({ startDate: "2026-12-20" })]);
    expect(fine.warnings.some((w) => w.type === "ORDER_LATE")).toBe(false);
  });

  it("is not late when the order-by date is today", () => {
    const planned = host(
      { status: "planned", availableFrom: null },
      { leadTimeDays: 0 },
    );
    const r = run([planned], [vm({ startDate: TODAY })]);
    expect(r.warnings.some((w) => w.type === "ORDER_LATE")).toBe(false);
  });

  it("reports unplaced and unscheduled VMs", () => {
    const unplaced = vm({ hostId: null });
    const unscheduled = vm({ startDate: null });
    const r = run([host()], [unplaced, unscheduled]);
    expect(r.unplacedVms.map((v) => v.id)).toEqual([unplaced.id]);
    expect(r.unscheduledVms.map((v) => v.id)).toEqual([unscheduled.id]);
    expect(r.warnings).toContainEqual({
      type: "VM_UNPLACED",
      severity: "warning",
      vmId: unplaced.id,
      taskId: unplaced.taskId,
    });
    expect(r.warnings).toContainEqual({
      type: "VM_UNSCHEDULED",
      severity: "info",
      vmId: unscheduled.id,
      taskId: unscheduled.taskId,
      hostId: "h1",
    });
  });

  it("reports only the highest over-threshold level per host", () => {
    const m = { ramGb: 100, hypervisorReserveGb: 0 };
    const at85 = run([host({}, m)], [vm({ ramGb: 85 })]);
    expect(at85.warnings.map((w) => w.type)).toEqual(["OVER_80"]);
    const at120 = run([host({}, m)], [vm({ ramGb: 120 })]);
    expect(at120.warnings.map((w) => w.type)).toEqual(["OVER_100"]);
  });
});

describe("cluster usable capacity", () => {
  it("applies k/(k+m) and the fill threshold", () => {
    expect(clusterUsableGb(cluster(), 600)).toBe(320);
    expect(
      clusterUsableGb(
        cluster({
          kind: "managed_service",
          ecDataChunks: null,
          ecCodingChunks: null,
        }),
        1000,
      ),
    ).toBe(800);
    expect(clusterUsableGb(cluster({ fillThresholdPercent: 100 }), 100)).toBe(
      66,
    );
  });

  it("counts only entries available on each date", () => {
    const c = cluster({
      entries: [
        entry({ capacityGb: 600, availableFrom: "2026-01-01" }),
        entry({
          capacityGb: 600,
          status: "ordered",
          availableFrom: "2026-12-01",
        }),
        entry({ capacityGb: 600, status: "planned", availableFrom: null }),
      ],
    });
    const r = computeClusterResult(c, [
      vm({
        hostId: null,
        storageClusterId: "c1",
        cephStorageGb: 100,
        startDate: "2026-11-10",
      }),
    ]);
    expect(r.steps).toEqual([
      { date: "2026-01-01", usedCephGb: 0, usableGb: 320, percent: 0 },
      { date: "2026-11-10", usedCephGb: 100, usableGb: 320, percent: 31.3 },
      { date: "2026-12-01", usedCephGb: 100, usableGb: 640, percent: 15.6 },
    ]);
    expect(r.needDate).toBe("2026-11-10");
    expect(r.usableAllGb).toBe(960);
    expect(r.shortfallGb).toBe(0);
    expect(r.suggestion).toBeNull();
  });

  it("flags thresholds against usable capacity, and no capacity as over 100", () => {
    const c = cluster({ entries: [entry({ capacityGb: 600 })] }); // 320 usable
    const r = computeClusterResult(c, [
      vm({
        storageClusterId: "c1",
        cephStorageGb: 256,
        startDate: "2026-11-01",
      }),
      vm({
        storageClusterId: "c1",
        cephStorageGb: 100,
        startDate: "2026-11-05",
      }),
    ]);
    expect(r.firstOver80Date).toBe("2026-11-01");
    expect(r.firstOver100Date).toBe("2026-11-05");
    const empty = computeClusterResult(cluster(), [
      vm({ storageClusterId: "c1", cephStorageGb: 1 }),
    ]);
    expect(empty.steps[0]).toMatchObject({ usableGb: 0, percent: null });
    expect(empty.firstOver100Date).toBe("2026-11-10");
  });
});

describe("cluster shortfall and suggestions", () => {
  const used = (gb: number, startDate = "2026-11-10") =>
    vm({ storageClusterId: "c1", cephStorageGb: gb, startDate });

  it("suggests nodes of the latest entry for a self-managed cluster", () => {
    const c = cluster({
      entries: [
        entry({ capacityGb: 100, createdAt: "2026-01-01T00:00:00.000Z" }),
        entry({
          capacityGb: 600,
          modelName: "STOR-2",
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
    });
    // usable all = floor(700*4*80/600)=373; used 1000 => shortfall 627
    // per node 600*4/6*0.8 = 320 => ceil(627/320) = 2
    const r = computeClusterResult(c, [used(1000)]);
    expect(r.shortfallGb).toBe(627);
    expect(r.suggestion).toMatchObject({
      kind: "nodes",
      nodes: 2,
      nodeCapacityGb: 600,
      modelName: "STOR-2",
      buyGb: null,
    });
  });

  it("has no node count without a reference entry", () => {
    const r = computeClusterResult(cluster(), [used(100)]);
    expect(r.suggestion).toMatchObject({
      kind: "nodes",
      nodes: null,
      nodeCapacityGb: null,
    });
  });

  it("suggests GB to buy for a managed service", () => {
    const c = cluster({
      kind: "managed_service",
      ecDataChunks: null,
      ecCodingChunks: null,
      entries: [entry({ capacityGb: 1000 })], // 800 usable
    });
    const r = computeClusterResult(c, [used(1000)]);
    expect(r.shortfallGb).toBe(200);
    expect(r.suggestion).toMatchObject({
      kind: "service",
      buyGb: 250,
      nodes: null,
    });
  });

  it("dates the suggestion by the day all capacity is first exceeded minus the lead time", () => {
    const c = cluster({
      leadTimeDays: 30,
      entries: [entry({ capacityGb: 600 })], // 320 usable
    });
    const r = computeClusterResult(c, [
      used(300, "2026-11-01"),
      used(100, "2026-12-15"),
    ]);
    expect(r.suggestion?.needDate).toBe("2026-12-15");
    expect(r.suggestion?.orderByDate).toBe("2026-11-15");
  });

  it("counts planned entries as delivered for the shortfall but not for readiness", () => {
    const c = cluster({
      entries: [
        entry({ capacityGb: 600 }), // 320 delivered
        entry({ capacityGb: 600, status: "planned", availableFrom: null }),
      ],
    });
    const r = computeClusterResult(c, [used(400)]);
    expect(r.shortfallGb).toBe(0);
    expect(r.plannedNeedDate).toBe("2026-11-10");
    const result = computeCapacity({
      hosts: [],
      clusters: [c],
      vms: [used(400)],
      today: TODAY,
    });
    expect(result.warnings.map((w) => w.type)).toEqual([
      "CLUSTER_NOT_READY",
      "ORDER_LATE",
    ]);
    // The planned entry is an order plan row.
    expect(result.orderPlan).toHaveLength(1);
    expect(result.orderPlan[0]).toMatchObject({
      type: "storage_node",
      status: "planned",
      orderByDate: "2026-10-11",
      late: true,
      capacityGb: 600,
    });
  });

  it("emits CLUSTER_SHORTFALL and a suggestion row", () => {
    const c = cluster({ entries: [entry({ capacityGb: 600 })] });
    const result = computeCapacity({
      hosts: [],
      clusters: [c],
      vms: [used(1000, "2026-12-01")],
      today: TODAY,
    });
    expect(result.warnings.map((w) => w.type)).toEqual(
      expect.arrayContaining(["CLUSTER_SHORTFALL"]),
    );
    expect(result.orderPlan).toEqual([
      expect.objectContaining({
        type: "storage_node",
        status: "suggested",
        quantity: 3, // ceil(680/320)
        capacityGb: 600,
        needDate: "2026-12-01",
        orderByDate: "2026-11-01",
        late: false,
        clusterName: "Ceph PAR",
      }),
    ]);
  });

  it("uses storage_service rows for managed clusters", () => {
    const c = cluster({
      kind: "managed_service",
      ecDataChunks: null,
      ecCodingChunks: null,
      region: "GRA",
    });
    const result = computeCapacity({
      hosts: [],
      clusters: [c],
      vms: [used(80)],
      today: TODAY,
    });
    expect(result.orderPlan[0]).toMatchObject({
      type: "storage_service",
      quantity: 1,
      capacityGb: 100,
      region: "GRA",
    });
  });
});

describe("order plan", () => {
  const planned = (id: string, overrides: Partial<CapHost> = {}) =>
    host({
      id,
      label: id,
      status: "planned",
      availableFrom: null,
      ...overrides,
    });

  it("groups identical planned hosts into one row with a quantity", () => {
    const hosts = [
      planned("a"),
      planned("b"),
      planned("c", { projectId: "p2", projectName: "P2" }),
    ];
    const vms = [
      vm({ hostId: "a" }),
      vm({ hostId: "b" }),
      vm({ hostId: "c", projectId: "p2" }),
    ];
    const r = computeCapacity({ hosts, vms, clusters: [], today: TODAY });
    expect(r.orderPlan).toHaveLength(2);
    const group = r.orderPlan.find((row) => row.projectId === "p1");
    expect(group).toMatchObject({
      type: "host",
      quantity: 2,
      labels: ["a", "b"],
      needDate: "2026-11-10",
      orderByDate: "2026-10-27",
      status: "planned",
      late: false,
      provider: "ovh",
      ramGb: 256,
      vcpu: 32,
      storageGb: 4000,
    });
  });

  it("does not group hosts with another need date, region or RAM, and skips ordered hosts", () => {
    const hosts = [
      planned("a"),
      planned("b"),
      planned("c", { region: "PAR" }),
      planned("d", {}),
      host({ id: "e", status: "ordered", availableFrom: "2026-11-01" }),
    ];
    const vms = [
      vm({ hostId: "a", startDate: "2026-11-10" }),
      vm({ hostId: "b", startDate: "2026-11-11" }),
      vm({ hostId: "c", startDate: "2026-11-10" }),
      vm({ hostId: "e" }),
    ];
    const r = computeCapacity({ hosts, vms, clusters: [], today: TODAY });
    // a, b, c have different (need date | region); d has no VMs (null dates).
    expect(r.orderPlan).toHaveLength(4);
    expect(r.orderPlan.every((row) => row.status === "planned")).toBe(true);
  });

  it("groups identical planned hosts per zone", () => {
    const hosts = [
      planned("a", { region: "PAR", zone: "PAR1" }),
      planned("b", { region: "PAR", zone: "PAR1" }),
      planned("c", { region: "PAR", zone: "PAR2" }),
    ];
    const vms = hosts.map((h) => vm({ hostId: h.id }));
    const r = computeCapacity({ hosts, vms, clusters: [], today: TODAY });
    expect(r.orderPlan.map((row) => [row.zone, row.quantity])).toEqual([
      ["PAR1", 2],
      ["PAR2", 1],
    ]);
  });

  it("sorts by order-by date (nulls last), region and model", () => {
    const hosts = [
      planned("a", { region: "PAR" }),
      planned("b", { region: "GRA" }),
      planned("c", { region: "GRA" }),
      planned("d", { region: "GRA" }),
    ];
    const vms = [
      vm({ hostId: "a", startDate: "2026-11-10" }),
      vm({ hostId: "b", startDate: "2026-11-10" }),
      vm({ hostId: "c", startDate: "2026-12-10" }),
    ];
    const r = computeCapacity({ hosts, vms, clusters: [], today: TODAY });
    expect(r.orderPlan.map((row) => [row.orderByDate, row.region])).toEqual([
      ["2026-10-27", "GRA"],
      ["2026-10-27", "PAR"],
      ["2026-11-26", "GRA"],
      [null, "GRA"],
    ]);
  });

  it("marks rows late when the order-by date is before today", () => {
    const r = computeCapacity({
      hosts: [planned("a")],
      vms: [vm({ hostId: "a", startDate: "2026-10-20" })],
      clusters: [],
      today: TODAY,
    });
    expect(r.orderPlan[0]).toMatchObject({
      orderByDate: "2026-10-06",
      late: true,
    });
  });
});
