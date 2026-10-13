import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  defineRole,
  infraWorld,
  modelBody,
  userWith,
} from "./helpers/infrastructure";

beforeEach(resetTestDatabase);

async function setup() {
  const w = await infraWorld();
  await defineRole(w.workspaceId, "dc", { datacenter: ["read", "manage"] });
  const dcUser = await userWith(w.workspaceId, "dc");
  const base = `/api/infrastructure/workspace/${w.workspaceId}/regions`;
  const regionId = async (code: string) =>
    (
      await db
        .select()
        .from(schema.infraRegionTable)
        .where(eq(schema.infraRegionTable.workspaceId, w.workspaceId))
    ).find((r) => r.code === code)?.id as string;
  const model = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/models`,
    modelBody({ regions: ["GRA", "PAR"] }),
  );
  const hostsUrl = `/api/infrastructure/project/${w.p1.id}/hosts`;
  const setZones = async (code: string, zones: string[]) => {
    const res = await w.call(dcUser, "PUT", `${base}/${await regionId(code)}`, {
      zones,
    });
    expect(res.status, res.text).toBe(200);
  };
  await setZones("PAR", ["PAR1", "PAR2", "PAR3"]);
  const addHosts = (body: Record<string, unknown>) =>
    w.call(w.owner, "POST", hostsUrl, {
      modelId: model.json.id,
      region: "PAR",
      ...body,
    });
  const hosts = () => db.select().from(schema.infraHostTable);
  return {
    ...w,
    dcUser,
    base,
    regionId,
    model: model.json,
    hostsUrl,
    addHosts,
    hosts,
    setZones,
  };
}

describe("region zones", () => {
  it("manages zones with the region and normalizes them", async () => {
    const w = await setup();
    const created = await w.call(w.dcUser, "POST", w.base, {
      code: "FRA",
      name: "Frankfurt",
      zones: [" fra-a ", "fra-b"],
    });
    expect(created.status, created.text).toBe(200);
    expect(created.json.zones).toEqual(["FRA-A", "FRA-B"]);
    expect(created.json.zoneUsage).toEqual({});
    const plain = await w.call(w.dcUser, "POST", w.base, {
      code: "LON",
      name: "London",
    });
    expect(plain.json.zones).toEqual([]);

    for (const bad of [
      ["PAR1", "par1"],
      ["bad zone"],
      ["A".repeat(17)],
      Array.from({ length: 21 }, (_, i) => `Z${i}`),
    ]) {
      const res = await w.call(
        w.dcUser,
        "PUT",
        `${w.base}/${created.json.id}`,
        { zones: bad },
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const [row] = await db
      .select()
      .from(schema.infraRegionTable)
      .where(eq(schema.infraRegionTable.id, created.json.id));
    expect(row.zones).toEqual(["FRA-A", "FRA-B"]);

    const list = await w.call(w.dcUser, "GET", w.base);
    expect(
      list.json.find((r: { code: string }) => r.code === "PAR").zones,
    ).toEqual(["PAR1", "PAR2", "PAR3"]);
  });

  it("shows zones to a project member in the project list", async () => {
    const w = await setup();
    await defineRole(w.workspaceId, "bare", { project: ["read"] });
    await defineRole(w.workspaceId, "reader", { infrastructure: ["read"] });
    const reader = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "reader",
    });
    const res = await w.call(
      reader,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/regions`,
    );
    expect(res.json.find((r: { code: string }) => r.code === "PAR")).toEqual({
      code: "PAR",
      name: "PAR",
      zones: ["PAR1", "PAR2", "PAR3"],
    });
  });

  it("refuses to remove a zone that a host uses and counts hosts per zone", async () => {
    const w = await setup();
    await w.addHosts({ quantity: 2, zones: ["PAR1", "PAR2"] });
    const url = `${w.base}/${await w.regionId("PAR")}`;
    const used = await w.call(w.dcUser, "PUT", url, {
      zones: ["PAR2", "PAR3"],
    });
    expect(used.status).toBe(409);
    expect(used.json.code).toBe("INFRA_ZONE_IN_USE");
    const [stored] = await db
      .select()
      .from(schema.infraRegionTable)
      .where(eq(schema.infraRegionTable.code, "PAR"));
    expect(stored.zones).toEqual(["PAR1", "PAR2", "PAR3"]);

    const free = await w.call(w.dcUser, "PUT", url, {
      zones: ["PAR1", "PAR2"],
    });
    expect(free.status, free.text).toBe(200);
    expect(free.json.zoneUsage).toEqual({ PAR1: 1, PAR2: 1 });
    // Adding and renaming do not touch the used zones.
    expect(
      (await w.call(w.dcUser, "PUT", url, { name: "Paris" })).json.zones,
    ).toEqual(["PAR1", "PAR2"]);
  });
});

describe("host zones", () => {
  it("requires a zone in a zoned region and rejects unknown zones", async () => {
    const w = await setup();
    const none = await w.addHosts({});
    expect(none.status).toBe(400);
    expect(none.json.code).toBe("INFRA_ZONE_REQUIRED");
    const unknown = await w.addHosts({ zones: ["PAR1", "PAR9"] });
    expect(unknown.status).toBe(400);
    expect(unknown.json.code).toBe("INFRA_ZONE_UNKNOWN");
    for (const zones of [[], ["PAR1", "PAR1"]]) {
      expect((await w.addHosts({ zones })).status).toBe(400);
    }
    expect(await w.hosts()).toHaveLength(0);
  });

  it("refuses zones in a region without zones", async () => {
    const w = await setup();
    const res = await w.addHosts({ region: "GRA", zones: ["GRA1"] });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_ZONE_UNKNOWN");
    const ok = await w.addHosts({ region: "GRA", quantity: 2 });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.hosts.map((h: { zone: unknown }) => h.zone)).toEqual([
      null,
      null,
    ]);
    expect(ok.json.hosts[0].label).toBe("ADVANCE-2 256 GB GRA #1");
    expect(await w.hosts()).toHaveLength(2);
  });

  it("spreads hosts round-robin and numbers labels per zone", async () => {
    const w = await setup();
    const one = await w.addHosts({
      quantity: 3,
      zones: ["PAR1", "PAR2", "PAR3"],
    });
    expect(one.status, one.text).toBe(200);
    expect(
      one.json.hosts.map((h: { zone: string; label: string }) => [
        h.zone,
        h.label,
      ]),
    ).toEqual([
      ["PAR1", "ADVANCE-2 256 GB PAR1 #1"],
      ["PAR2", "ADVANCE-2 256 GB PAR2 #1"],
      ["PAR3", "ADVANCE-2 256 GB PAR3 #1"],
    ]);
    const four = await w.addHosts({
      quantity: 4,
      zones: ["PAR1", "PAR2", "PAR3"],
    });
    expect(
      four.json.hosts.map((h: { zone: string; label: string }) => [
        h.zone,
        h.label,
      ]),
    ).toEqual([
      ["PAR1", "ADVANCE-2 256 GB PAR1 #2"],
      ["PAR2", "ADVANCE-2 256 GB PAR2 #2"],
      ["PAR3", "ADVANCE-2 256 GB PAR3 #2"],
      ["PAR1", "ADVANCE-2 256 GB PAR1 #3"],
    ]);
    const custom = await w.addHosts({ zones: ["PAR2"], label: "Mine" });
    expect(custom.json.hosts[0]).toMatchObject({ label: "Mine", zone: "PAR2" });
    const list = await w.call(w.owner, "GET", w.hostsUrl);
    expect(list.json.every((h: { zone: string }) => h.zone)).toBe(true);
  });

  it("changes region and zone only while planned and validates them", async () => {
    const w = await setup();
    const created = await w.addHosts({ zones: ["PAR1"] });
    const host = created.json.hosts[0];
    const url = `${w.hostsUrl}/${host.id}`;

    const moved = await w.call(w.owner, "PUT", url, { zone: "PAR3" });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.json.zone).toBe("PAR3");
    for (const [body, code] of [
      [{ zone: "PAR9" }, "INFRA_ZONE_UNKNOWN"],
      [{ zone: null }, "INFRA_ZONE_REQUIRED"],
      [{ region: "GRA", zone: "PAR1" }, "INFRA_ZONE_UNKNOWN"],
    ] as [Record<string, unknown>, string][]) {
      const res = await w.call(w.owner, "PUT", url, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.code).toBe(code);
    }
    // Into a zoneless region: the zone is dropped.
    const toGra = await w.call(w.owner, "PUT", url, { region: "GRA" });
    expect(toGra.status, toGra.text).toBe(200);
    expect(toGra.json).toMatchObject({ region: "GRA", zone: null });
    // Back into a zoned region needs a zone.
    const back = await w.call(w.owner, "PUT", url, { region: "PAR" });
    expect(back.status).toBe(400);
    expect(back.json.code).toBe("INFRA_ZONE_REQUIRED");
    expect(
      (await w.call(w.owner, "PUT", url, { region: "PAR", zone: "PAR2" })).json,
    ).toMatchObject({ region: "PAR", zone: "PAR2" });

    await db
      .update(schema.infraHostTable)
      .set({ status: "ordered", availableFrom: "2026-12-01" })
      .where(eq(schema.infraHostTable.id, host.id));
    const locked = await w.call(w.owner, "PUT", url, { zone: "PAR1" });
    expect(locked.status).toBe(409);
    expect(locked.json.code).toBe("INFRA_HOST_LOCKED");
    expect((await w.hosts())[0].zone).toBe("PAR2");
    // The same zone and a rename stay fine on an ordered host.
    expect(
      (await w.call(w.owner, "PUT", url, { zone: "PAR2", label: "x" })).status,
    ).toBe(200);
  });
});

describe("zones and storage", () => {
  it("lets VMs in different zones of a region use one cluster", async () => {
    const w = await setup();
    const clusters = `/api/infrastructure/workspace/${w.workspaceId}/storage-clusters`;
    const cluster = await w.call(w.dcUser, "POST", clusters, {
      name: "Ceph PAR",
      region: "PAR",
      kind: "managed_service",
    });
    expect(cluster.status, cluster.text).toBe(200);
    const created = await w.addHosts({ quantity: 2, zones: ["PAR1", "PAR3"] });
    const [h1, h3] = created.json.hosts;
    const vm = (name: string, hostId: string) => ({
      name,
      vcpu: 1,
      ramGb: 1,
      localStorageGb: 1,
      cephStorageGb: 10,
      storageClusterId: cluster.json.id,
      hostId,
    });
    const res = await w.call(
      w.owner,
      "PUT",
      `/api/infrastructure/task/${w.task1.id}/vms`,
      { vms: [vm("a", h1.id), vm("b", h3.id)] },
    );
    expect(res.status, res.text).toBe(200);
    expect(
      res.json.map((v: { host: { zone: string } }) => v.host.zone),
    ).toEqual(["PAR1", "PAR3"]);
  });
});
