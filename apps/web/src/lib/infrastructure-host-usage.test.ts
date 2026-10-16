import { describe, expect, it } from "vitest";
import {
  computeHostUsage,
  type EditorRowUsage,
  freeCapacityForRow,
  type HostUsageInput,
  isOverCapacity,
  type SavedVmUsage,
} from "./infrastructure-host-usage";

const host = (
  id: string,
  totals: HostUsageInput["totals"] = { vcpu: 0, ramGb: 0, localStorageGb: 0 },
): HostUsageInput => ({
  id,
  model: { ramGb: 256, vcpu: 64, storageGb: 1000, hypervisorReserveGb: 18 },
  totals,
});

const row = (
  key: string,
  hostId: string | null,
  ramGb: string,
  vcpu = "0",
  localStorageGb = "0",
): EditorRowUsage => ({ key, hostId, ramGb, vcpu, localStorageGb });

const saved = (
  hostId: string | null,
  ramGb: number,
  vcpu: number,
  localStorageGb = 0,
): SavedVmUsage => ({ hostId, ramGb, vcpu, localStorageGb });

describe("computeHostUsage", () => {
  it("reserves part of the RAM for the hypervisor (rounded down)", () => {
    const usage = computeHostUsage([host("a")], [], []).get("a");
    // 256 GB RAM minus the 18 GB reserve
    expect(usage?.ram.capacity).toBe(238);
    expect(usage?.vcpu.capacity).toBe(64);
    expect(usage?.localStorage.capacity).toBe(1000);
  });

  it("subtracts the saved VMs of this task from the host totals", () => {
    const hosts = [host("a", { vcpu: 12, ramGb: 100, localStorageGb: 300 })];
    const savedVms = [saved("a", 40, 4, 100), saved("b", 99, 99, 99)];
    const rows = [row("r1", "a", "40", "4", "100")];
    const usage = computeHostUsage(hosts, savedVms, rows).get("a");
    expect(usage?.ram.used).toBe(100);
    expect(usage?.vcpu.used).toBe(12);
    expect(usage?.localStorage.used).toBe(300);
  });

  it("counts unsaved edits and treats invalid input as 0", () => {
    const hosts = [host("a", { vcpu: 4, ramGb: 40, localStorageGb: 0 })];
    const savedVms = [saved("a", 40, 4)];
    const rows = [row("r1", "a", "100", "abc"), row("r2", "a", "")];
    const usage = computeHostUsage(hosts, savedVms, rows).get("a");
    expect(usage?.ram.used).toBe(100);
    expect(usage?.vcpu.used).toBe(0);
  });

  it("moves a row from host A to host B in both projections", () => {
    const hosts = [
      host("a", { vcpu: 8, ramGb: 64, localStorageGb: 0 }),
      host("b", { vcpu: 0, ramGb: 0, localStorageGb: 0 }),
    ];
    const savedVms = [saved("a", 64, 8)];
    const before = computeHostUsage(hosts, savedVms, [
      row("r1", "a", "64", "8"),
    ]);
    expect(before.get("a")?.ram.used).toBe(64);
    expect(before.get("b")?.ram.used).toBe(0);

    const after = computeHostUsage(hosts, savedVms, [
      row("r1", "b", "64", "8"),
    ]);
    expect(after.get("a")?.ram.used).toBe(0);
    expect(after.get("a")?.vcpu.used).toBe(0);
    expect(after.get("b")?.ram.used).toBe(64);
    expect(after.get("b")?.vcpu.used).toBe(8);
  });

  it("flags a host over capacity", () => {
    const hosts = [host("a", { vcpu: 0, ramGb: 200, localStorageGb: 0 })];
    const fits = computeHostUsage(hosts, [], [row("r1", "a", "38")]).get("a");
    const over = computeHostUsage(hosts, [], [row("r1", "a", "39")]).get("a");
    expect(fits && isOverCapacity(fits)).toBe(false);
    expect(over && isOverCapacity(over)).toBe(true);
  });
});

describe("freeCapacityForRow", () => {
  it("excludes the row itself but keeps others and other rows", () => {
    const a = host("a", { vcpu: 10, ramGb: 100, localStorageGb: 50 });
    const savedVms = [saved("a", 20, 2, 10)];
    const rows = [
      row("r1", "a", "20", "2", "10"),
      row("r2", "a", "30", "3", "5"),
    ];
    // Others: 80 RAM, 8 vCPU, 40 disk. Row r2: 30 / 3 / 5.
    expect(freeCapacityForRow(a, savedVms, rows, "r1")).toEqual({
      ram: 238 - 80 - 30,
      vcpu: 64 - 8 - 3,
      localStorage: 1000 - 40 - 5,
    });
  });

  it("is the full remaining capacity for a row on another host", () => {
    const a = host("a", { vcpu: 0, ramGb: 100, localStorageGb: 0 });
    const rows = [row("r1", "b", "500")];
    expect(freeCapacityForRow(a, [], rows, "r1").ram).toBe(138);
  });
});
