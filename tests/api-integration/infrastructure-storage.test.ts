import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  defineRole,
  infraWorld,
  insertTask,
  modelBody,
  userWith,
} from "./helpers/infrastructure";

beforeEach(resetTestDatabase);

const selfManaged = (overrides: Record<string, unknown> = {}) => ({
  name: "Ceph PAR",
  region: "par",
  kind: "self_managed",
  ecDataChunks: 4,
  ecCodingChunks: 2,
  ...overrides,
});
const managed = (overrides: Record<string, unknown> = {}) => ({
  name: "Ceph GRA",
  region: "GRA",
  kind: "managed_service",
  ...overrides,
});

async function setup() {
  const w = await infraWorld();
  const base = `/api/infrastructure/workspace/${w.workspaceId}/storage-clusters`;
  await defineRole(w.workspaceId, "dc", { datacenter: ["read", "manage"] });
  await defineRole(w.workspaceId, "bare", { project: ["read"] });
  await defineRole(w.workspaceId, "infra_reader", {
    infrastructure: ["read"],
  });
  await defineRole(w.workspaceId, "infra_planner", {
    infrastructure: ["read", "plan"],
  });
  const dcUser = await userWith(w.workspaceId, "dc");
  const create = async (body: Record<string, unknown>) => {
    const res = await w.call(dcUser, "POST", base, body);
    expect(res.status, res.text).toBe(200);
    return res.json;
  };
  const clusters = () => db.select().from(schema.infraStorageClusterTable);
  const vms = () => db.select().from(schema.infraVmTable);
  const putVms = (
    taskId: string,
    items: Record<string, unknown>[],
    user: unknown = w.owner,
  ) =>
    w.call(user, "PUT", `/api/infrastructure/task/${taskId}/vms`, {
      vms: items,
    });
  const vm = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    vcpu: 1,
    ramGb: 1,
    localStorageGb: 10,
    hostId: null,
    ...extra,
  });
  return { ...w, base, dcUser, create, clusters, vms, putVms, vm };
}

type World = Awaited<ReturnType<typeof setup>>;

async function planHost(w: World, region: string) {
  const model = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/models`,
    modelBody({ regions: ["GRA", "PAR"] }),
  );
  const host = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/hosts`,
    { modelId: model.json.id, region },
  );
  expect(host.status, host.text).toBe(200);
  return host.json;
}

describe("storage cluster permissions", () => {
  it("shows a project member only id, name, region and kind", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    await w.call(w.dcUser, "POST", `${w.base}/${cluster.id}/capacity`, {
      capacityGb: 1000,
    });
    const reader = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "infra_reader",
    });
    const res = await w.call(
      reader,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/storage-clusters`,
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual([
      { id: cluster.id, name: "Ceph PAR", region: "PAR", kind: "self_managed" },
    ]);
    expect(res.text).not.toMatch(/capacity|ecData|fillThreshold|usedCeph/i);
  });

  it("keeps project members out of the datacenter storage routes", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    const planner = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "infra_planner",
    });
    expect((await w.call(planner, "GET", w.base)).status).toBe(403);
    expect((await w.call(planner, "POST", w.base, managed())).status).toBe(403);
    expect(
      (await w.call(planner, "PUT", `${w.base}/${cluster.id}`, { name: "x" }))
        .status,
    ).toBe(403);
    expect(
      (await w.call(planner, "DELETE", `${w.base}/${cluster.id}`)).status,
    ).toBe(403);
    expect(
      (
        await w.call(planner, "POST", `${w.base}/${cluster.id}/capacity`, {
          capacityGb: 1,
        })
      ).status,
    ).toBe(403);
    expect(await w.clusters()).toHaveLength(1);
    expect((await w.clusters())[0].name).toBe("Ceph PAR");
  });

  it("lets a DC role without project membership manage clusters and entries, but not use project routes", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    expect(
      (await w.call(w.dcUser, "PUT", `${w.base}/${cluster.id}`, { name: "N" }))
        .status,
    ).toBe(200);
    const entry = await w.call(
      w.dcUser,
      "POST",
      `${w.base}/${cluster.id}/capacity`,
      { capacityGb: 500 },
    );
    expect(entry.status).toBe(200);
    expect(
      (
        await w.call(
          w.dcUser,
          "PUT",
          `${w.base}/${cluster.id}/capacity/${entry.json.id}`,
          { capacityGb: 600 },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await w.call(
          w.dcUser,
          "DELETE",
          `${w.base}/${cluster.id}/capacity/${entry.json.id}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await w.call(w.dcUser, "DELETE", `${w.base}/${cluster.id}`)).status,
    ).toBe(200);
    expect(await w.clusters()).toHaveLength(0);
    expect(
      (
        await w.call(
          w.dcUser,
          "GET",
          `/api/infrastructure/project/${w.p1.id}/storage-clusters`,
        )
      ).status,
    ).toBe(403);
  });

  it("answers 403 to another workspace and 404 for a foreign cluster id", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    const other = await infraWorld();
    const otherBase = `/api/infrastructure/workspace/${other.workspaceId}/storage-clusters`;
    expect((await other.call(other.owner, "GET", w.base)).status).toBe(403);
    expect(
      (await other.call(other.owner, "POST", w.base, managed())).status,
    ).toBe(403);
    // Own workspace path with the foreign cluster id.
    for (const [method, path, body] of [
      ["PUT", `${otherBase}/${cluster.id}`, { name: "x" }],
      ["DELETE", `${otherBase}/${cluster.id}`],
      ["POST", `${otherBase}/${cluster.id}/capacity`, { capacityGb: 5 }],
    ] as [string, string, unknown?][]) {
      expect((await other.call(other.owner, method, path, body)).status).toBe(
        404,
      );
    }
    expect(await w.clusters()).toHaveLength(1);
    expect(
      await db.select().from(schema.infraStorageCapacityTable),
    ).toHaveLength(0);
  });
});

describe("storage cluster rules", () => {
  it("validates the kind and erasure coding", async () => {
    const w = await setup();
    for (const bad of [
      selfManaged({ ecDataChunks: undefined, ecCodingChunks: undefined }),
      selfManaged({ ecCodingChunks: undefined }),
      selfManaged({ ecDataChunks: 0 }),
      managed({ ecDataChunks: 4 }),
      managed({ ecCodingChunks: 2 }),
      selfManaged({ kind: "other" }),
      selfManaged({ fillThresholdPercent: 0 }),
      selfManaged({ fillThresholdPercent: 101 }),
      selfManaged({ leadTimeDays: -1 }),
      selfManaged({ region: "bad region" }),
    ]) {
      const res = await w.call(w.dcUser, "POST", w.base, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await w.clusters()).toHaveLength(0);

    const ok = await w.create(selfManaged());
    expect(ok.fillThresholdPercent).toBe(80);
    expect(ok.region).toBe("PAR");
    const service = await w.create(managed());
    expect(service.ecDataChunks).toBeNull();

    // Kind switches keep consistency.
    const url = `${w.base}/${service.id}`;
    const noKm = await w.call(w.dcUser, "PUT", url, { kind: "self_managed" });
    expect(noKm.status).toBe(400);
    expect(noKm.json.code).toBe("INFRA_CLUSTER_INVALID");
    const toSelf = await w.call(w.dcUser, "PUT", url, {
      kind: "self_managed",
      ecDataChunks: 8,
      ecCodingChunks: 3,
    });
    expect(toSelf.status, toSelf.text).toBe(200);
    expect(toSelf.json.ecDataChunks).toBe(8);
    const toManaged = await w.call(w.dcUser, "PUT", `${w.base}/${ok.id}`, {
      kind: "managed_service",
    });
    expect(toManaged.status).toBe(200);
    expect(toManaged.json.ecDataChunks).toBeNull();
    expect(toManaged.json.ecCodingChunks).toBeNull();
    const kWithManaged = await w.call(w.dcUser, "PUT", `${w.base}/${ok.id}`, {
      ecDataChunks: 4,
    });
    expect(kWithManaged.status).toBe(400);
  });

  it("refuses a duplicate name in the workspace", async () => {
    const w = await setup();
    const first = await w.create(selfManaged());
    const dup = await w.call(
      w.dcUser,
      "POST",
      w.base,
      managed({ name: "Ceph PAR" }),
    );
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("INFRA_CLUSTER_NAME_TAKEN");
    const second = await w.create(managed());
    const rename = await w.call(w.dcUser, "PUT", `${w.base}/${second.id}`, {
      name: "Ceph PAR",
    });
    expect(rename.status).toBe(409);
    expect(rename.json.code).toBe("INFRA_CLUSTER_NAME_TAKEN");
    expect(await w.clusters()).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    // Another workspace may reuse the name.
    const other = await infraWorld();
    const res = await other.call(
      other.owner,
      "POST",
      `/api/infrastructure/workspace/${other.workspaceId}/storage-clusters`,
      selfManaged(),
    );
    expect(res.status).toBe(200);
  });

  it("applies the status rules to capacity entries", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    const post = (body: Record<string, unknown>) =>
      w.call(w.dcUser, "POST", `${w.base}/${cluster.id}/capacity`, body);
    const a = await post({ capacityGb: 1000, modelName: "STOR-1" });
    expect(a.json.label).toBe("Ceph PAR #1");
    expect(a.json.status).toBe("planned");
    expect((await post({ capacityGb: 1000 })).json.label).toBe("Ceph PAR #2");
    expect((await post({ capacityGb: 0 })).status).toBe(400);

    const url = `${w.base}/${cluster.id}/capacity/${a.json.id}`;
    const noDate = await w.call(w.dcUser, "PUT", url, { status: "ordered" });
    expect(noDate.status).toBe(400);
    expect(noDate.json.code).toBe("INFRA_AVAILABLE_FROM_REQUIRED");
    const [stored] = await db
      .select()
      .from(schema.infraStorageCapacityTable)
      .where(eq(schema.infraStorageCapacityTable.id, a.json.id));
    expect(stored.status).toBe("planned");

    const ordered = await w.call(w.dcUser, "PUT", url, {
      status: "ordered",
      availableFrom: "2026-12-01",
      hostname: "stor-01",
    });
    expect(ordered.status).toBe(200);
    expect(ordered.json.availableFrom).toBe("2026-12-01");
    const locked = await w.call(w.dcUser, "DELETE", url);
    expect(locked.status).toBe(409);
    expect(locked.json.code).toBe("INFRA_CAPACITY_LOCKED");

    const installed = await w.call(w.dcUser, "PUT", url, {
      status: "installed",
    });
    expect(installed.json.availableFrom).toBe(
      new Date().toISOString().slice(0, 10),
    );
    expect(installed.json.hostname).toBe("stor-01");
    expect(
      (await w.call(w.dcUser, "PUT", url, { status: "planned" })).json
        .availableFrom,
    ).toBeNull();
  });
});

describe("storage totals and VM references", () => {
  it("sums installed vs planned capacity and Ceph use across projects", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    const add = async (capacityGb: number, status: string) => {
      const e = await w.call(
        w.dcUser,
        "POST",
        `${w.base}/${cluster.id}/capacity`,
        { capacityGb },
      );
      if (status !== "planned") {
        await w.call(
          w.dcUser,
          "PUT",
          `${w.base}/${cluster.id}/capacity/${e.json.id}`,
          { status, availableFrom: "2026-12-01" },
        );
      }
    };
    await add(1000, "installed");
    await add(2000, "installed");
    await add(500, "ordered");
    await add(700, "planned");

    const r1 = await w.putVms(w.task1.id, [
      w.vm("a", { cephStorageGb: 300, storageClusterId: cluster.id }),
      w.vm("b", { cephStorageGb: 100, storageClusterId: cluster.id }),
    ]);
    expect(r1.status, r1.text).toBe(200);
    expect(r1.json[0].storageCluster).toEqual({
      id: cluster.id,
      name: "Ceph PAR",
      region: "PAR",
      kind: "self_managed",
    });
    expect(r1.json[0].localStorageGb).toBe(10);
    const r2 = await w.putVms(w.task2.id, [
      w.vm("c", { cephStorageGb: 50, storageClusterId: cluster.id }),
      w.vm("d", { cephStorageGb: 999 }),
    ]);
    expect(r2.status, r2.text).toBe(200);
    expect(r2.json[1].storageCluster).toBeNull();

    const list = await w.call(w.dcUser, "GET", w.base);
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);
    expect(list.json[0].capacity).toHaveLength(4);
    expect(list.json[0].totals).toEqual({
      rawCapacityGb: 3000,
      plannedOrOrderedCapacityGb: 1200,
      usedCephGb: 450,
      vmCount: 3,
    });
  });

  it("rejects a cluster of another workspace and keeps the list", async () => {
    const w = await setup();
    const other = await infraWorld();
    const foreign = await other.call(
      other.owner,
      "POST",
      `/api/infrastructure/workspace/${other.workspaceId}/storage-clusters`,
      selfManaged({ name: "Foreign" }),
    );
    const own = await w.create(selfManaged());
    await w.putVms(w.task1.id, [
      w.vm("keep", { cephStorageGb: 5, storageClusterId: own.id }),
    ]);
    const res = await w.putVms(w.task1.id, [
      w.vm("new"),
      w.vm("bad", { storageClusterId: foreign.json.id }),
    ]);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_CLUSTER_NOT_IN_WORKSPACE");
    expect((await w.vms()).map((v) => v.name)).toEqual(["keep"]);
  });

  it("rejects a cluster in another region than the host and keeps the list", async () => {
    const w = await setup();
    const par = await w.create(selfManaged());
    const hostGra = await planHost(w, "GRA");
    await w.putVms(w.task1.id, [w.vm("keep")]);
    const res = await w.putVms(w.task1.id, [
      w.vm("mismatch", { hostId: hostGra.id, storageClusterId: par.id }),
    ]);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_CLUSTER_REGION_MISMATCH");
    expect((await w.vms()).map((v) => v.name)).toEqual(["keep"]);

    const hostPar = await planHost(w, "PAR");
    const ok = await w.putVms(w.task1.id, [
      w.vm("fits", { hostId: hostPar.id, storageClusterId: par.id }),
    ]);
    expect(ok.status, ok.text).toBe(200);
  });

  it("blocks deleting a used cluster until its last VM is gone", async () => {
    const w = await setup();
    const cluster = await w.create(managed());
    await w.putVms(w.task1.id, [
      w.vm("a", { cephStorageGb: 10, storageClusterId: cluster.id }),
    ]);
    const blocked = await w.call(w.dcUser, "DELETE", `${w.base}/${cluster.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("INFRA_CLUSTER_IN_USE");
    expect(await w.clusters()).toHaveLength(1);

    // The region of a used cluster is fixed, so a VM's cluster cannot drift
    // away from its host's region.
    const moved = await w.call(w.dcUser, "PUT", `${w.base}/${cluster.id}`, {
      region: "WAW",
    });
    expect(moved.status).toBe(409);
    expect(moved.json.code).toBe("INFRA_REGION_IN_USE");
    expect((await w.clusters())[0]?.region).toBe(cluster.region);

    await w.putVms(w.task1.id, []);
    expect(
      (await w.call(w.dcUser, "DELETE", `${w.base}/${cluster.id}`)).status,
    ).toBe(200);
    expect(await w.clusters()).toHaveLength(0);
  });

  it("deletes clusters and entries with the workspace", async () => {
    const w = await setup();
    const cluster = await w.create(selfManaged());
    await w.call(w.dcUser, "POST", `${w.base}/${cluster.id}/capacity`, {
      capacityGb: 100,
    });
    const extra = await insertTask(w.p1.id, (await firstColumn(w.p1.id)).id);
    await w.putVms(extra.id, [
      w.vm("a", { cephStorageGb: 1, storageClusterId: cluster.id }),
    ]);
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, w.workspaceId));
    expect(await w.clusters()).toHaveLength(0);
    expect(
      await db.select().from(schema.infraStorageCapacityTable),
    ).toHaveLength(0);
    expect(await w.vms()).toHaveLength(0);
  });
});

async function firstColumn(projectId: string) {
  const [column] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
  return column;
}
