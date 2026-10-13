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
  const ws = w.workspaceId;
  await defineRole(ws, "bare", { project: ["read"] });
  await defineRole(ws, "infra_reader", { infrastructure: ["read"] });
  await defineRole(ws, "infra_planner", { infrastructure: ["read", "plan"] });
  await defineRole(ws, "dc", { datacenter: ["read", "manage"] });
  const dcUser = await userWith(ws, "dc");
  const reader = await userWith(ws, "bare", {
    id: w.p1.id,
    role: "infra_reader",
  });
  const planner = await userWith(ws, "bare", {
    id: w.p1.id,
    role: "infra_planner",
  });
  const base = `/api/infrastructure/workspace/${ws}/regions`;
  const regions = () => db.select().from(schema.infraRegionTable);
  const models = () => db.select().from(schema.infraModelTable);
  const clusters = () => db.select().from(schema.infraStorageClusterTable);
  const regionId = async (code: string) =>
    (await regions()).find((r) => r.code === code)?.id as string;
  return {
    ...w,
    dcUser,
    reader,
    planner,
    base,
    regions,
    models,
    clusters,
    regionId,
  };
}

type World = Awaited<ReturnType<typeof setup>>;

const modelUrl = (w: World) => `/api/infrastructure/project/${w.p1.id}/models`;

async function modelWith(w: World, regions: string[]) {
  const res = await w.call(
    w.owner,
    "POST",
    modelUrl(w),
    modelBody({ regions }),
  );
  expect(res.status, res.text).toBe(200);
  return res.json;
}

describe("region permissions", () => {
  it("lets a project member list the project regions and nothing more", async () => {
    const w = await setup();
    const res = await w.call(
      w.reader,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/regions`,
    );
    expect(res.status).toBe(200);
    expect(res.json.map((r: { code: string }) => r.code)).toEqual([
      "GRA",
      "PAR",
      "SBG",
      "PAR-2",
      "WAW",
    ]);
    expect(Object.keys(res.json[0]).sort()).toEqual(["code", "name", "zones"]);
    // No infrastructure:read, no list.
    const bare = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "bare",
    });
    expect(
      (
        await w.call(
          bare,
          "GET",
          `/api/infrastructure/project/${w.p1.id}/regions`,
        )
      ).status,
    ).toBe(403);

    // Workspace routes need datacenter permissions.
    const id = await w.regionId("GRA");
    for (const user of [w.reader, w.planner]) {
      expect((await w.call(user, "GET", w.base)).status).toBe(403);
      expect(
        (await w.call(user, "POST", w.base, { code: "NEW", name: "New" }))
          .status,
      ).toBe(403);
      expect(
        (await w.call(user, "PUT", `${w.base}/${id}`, { name: "x" })).status,
      ).toBe(403);
      expect((await w.call(user, "DELETE", `${w.base}/${id}`)).status).toBe(
        403,
      );
    }
    expect(await w.regions()).toHaveLength(5);
  });

  it("lets a DC role without project membership manage regions", async () => {
    const w = await setup();
    const created = await w.call(w.dcUser, "POST", w.base, {
      code: "lon",
      name: "London",
    });
    expect(created.status, created.text).toBe(200);
    expect(created.json).toMatchObject({
      code: "LON",
      name: "London",
      usage: { models: 0, hosts: 0, clusters: 0 },
    });
    const list = await w.call(w.dcUser, "GET", w.base);
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(6);

    const url = `${w.base}/${created.json.id}`;
    const renamed = await w.call(w.dcUser, "PUT", url, {
      name: "London UK",
      position: 9,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({
      code: "LON",
      name: "London UK",
      position: 9,
    });
    // The code is immutable: it is not accepted in the body.
    await w.call(w.dcUser, "PUT", url, { code: "XXX" });
    expect((await w.regions()).some((r) => r.code === "XXX")).toBe(false);

    expect((await w.call(w.dcUser, "DELETE", url)).status).toBe(200);
    expect(await w.regions()).toHaveLength(5);
    // The DC role is not a project member.
    expect(
      (
        await w.call(
          w.dcUser,
          "GET",
          `/api/infrastructure/project/${w.p1.id}/regions`,
        )
      ).status,
    ).toBe(403);
  });

  it("answers 403 to another workspace and 404 for a foreign region id", async () => {
    const w = await setup();
    const other = await infraWorld();
    expect((await other.call(other.owner, "GET", w.base)).status).toBe(403);
    expect(
      (await other.call(other.owner, "POST", w.base, { code: "X", name: "X" }))
        .status,
    ).toBe(403);
    const foreign = await w.regionId("GRA");
    const ownBase = `/api/infrastructure/workspace/${other.workspaceId}/regions`;
    expect(
      (
        await other.call(other.owner, "PUT", `${ownBase}/${foreign}`, {
          name: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (await other.call(other.owner, "DELETE", `${ownBase}/${foreign}`)).status,
    ).toBe(404);
    expect(await w.regions()).toHaveLength(10);
  });
});

describe("region catalog rules", () => {
  it("normalizes codes and refuses duplicates", async () => {
    const w = await setup();
    const res = await w.call(w.dcUser, "POST", w.base, {
      code: " lon-1 ",
      name: "London",
    });
    expect(res.json.code).toBe("LON-1");
    for (const code of ["lon-1", "LON-1", "gra"]) {
      const dup = await w.call(w.dcUser, "POST", w.base, { code, name: "Dup" });
      expect(dup.status).toBe(409);
      expect(dup.json.code).toBe("INFRA_REGION_CODE_TAKEN");
    }
    for (const bad of ["", "bad code", "A".repeat(17)]) {
      expect(
        (await w.call(w.dcUser, "POST", w.base, { code: bad, name: "X" }))
          .status,
      ).toBe(400);
    }
    expect(await w.regions()).toHaveLength(6);
    // Another workspace may use the same code.
    const other = await infraWorld();
    const ok = await other.call(
      other.owner,
      "POST",
      `/api/infrastructure/workspace/${other.workspaceId}/regions`,
      { code: "LON-1", name: "London" },
    );
    expect(ok.status).toBe(200);
  });

  it("rejects unknown regions on models and clusters and persists nothing", async () => {
    const w = await setup();
    const created = await w.call(
      w.owner,
      "POST",
      modelUrl(w),
      modelBody({ regions: ["GRA", "ZZZ", "YYY"] }),
    );
    expect(created.status).toBe(400);
    expect(created.json.code).toBe("INFRA_REGION_UNKNOWN");
    expect(created.json.message).toContain("ZZZ");
    expect(created.json.message).toContain("YYY");
    expect(await w.models()).toHaveLength(0);

    const model = await modelWith(w, ["GRA"]);
    const update = await w.call(w.owner, "PUT", `${modelUrl(w)}/${model.id}`, {
      regions: ["GRA", "ZZZ"],
    });
    expect(update.status).toBe(400);
    expect(update.json.code).toBe("INFRA_REGION_UNKNOWN");
    expect((await w.models())[0].regions).toEqual(["GRA"]);

    const base = `/api/infrastructure/workspace/${w.workspaceId}/storage-clusters`;
    const cluster = {
      name: "Ceph",
      region: "ZZZ",
      kind: "managed_service",
    };
    const bad = await w.call(w.dcUser, "POST", base, cluster);
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INFRA_REGION_UNKNOWN");
    expect(await w.clusters()).toHaveLength(0);

    const ok = await w.call(w.dcUser, "POST", base, {
      ...cluster,
      region: "GRA",
    });
    expect(ok.status, ok.text).toBe(200);
    const move = await w.call(w.dcUser, "PUT", `${base}/${ok.json.id}`, {
      region: "ZZZ",
    });
    expect(move.status).toBe(400);
    expect(move.json.code).toBe("INFRA_REGION_UNKNOWN");
    expect((await w.clusters())[0].region).toBe("GRA");
  });

  it("refuses to delete a region that a model, a host or a cluster uses", async () => {
    const w = await setup();
    const model = await modelWith(w, ["GRA", "PAR"]);
    const del = (code: string) =>
      w
        .regionId(code)
        .then((id) => w.call(w.dcUser, "DELETE", `${w.base}/${id}`));

    // Used by a model only (SBG is listed by no host).
    await w.call(w.owner, "PUT", `${modelUrl(w)}/${model.id}`, {
      regions: ["GRA", "PAR", "SBG"],
    });
    const byModel = await del("SBG");
    expect(byModel.status).toBe(409);
    expect(byModel.json.code).toBe("INFRA_REGION_IN_USE");

    // Used by a host.
    await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p1.id}/hosts`,
      {
        modelId: model.id,
        region: "PAR",
      },
    );
    expect((await del("PAR")).status).toBe(409);

    // Used by a cluster.
    await w.call(
      w.dcUser,
      "POST",
      `/api/infrastructure/workspace/${w.workspaceId}/storage-clusters`,
      { name: "Ceph", region: "WAW", kind: "managed_service" },
    );
    expect((await del("WAW")).status).toBe(409);

    const list = await w.call(w.dcUser, "GET", w.base);
    const usage = (code: string) =>
      list.json.find((r: { code: string }) => r.code === code).usage;
    expect(usage("PAR")).toEqual({ models: 1, hosts: 1, clusters: 0 });
    expect(usage("GRA")).toEqual({ models: 1, hosts: 0, clusters: 0 });
    expect(usage("WAW")).toEqual({ models: 0, hosts: 0, clusters: 1 });
    expect(await w.regions()).toHaveLength(5);

    // An unused region is deleted, and a model of ANOTHER workspace does not
    // block it.
    const other = await infraWorld();
    await other.call(
      other.owner,
      "POST",
      `/api/infrastructure/project/${other.p1.id}/models`,
      modelBody({ regions: ["PAR-2"] }),
    );
    const free = await del("PAR-2");
    expect(free.status).toBe(200);
    expect(
      (await w.regions()).filter((r) => r.workspaceId === w.workspaceId),
    ).toHaveLength(4);
    // Deleting the model's region list entry frees SBG.
    await w.call(w.owner, "PUT", `${modelUrl(w)}/${model.id}`, {
      regions: ["GRA", "PAR"],
    });
    expect((await del("SBG")).status).toBe(200);
  });
});

describe("host quantity", () => {
  it("creates consecutive hosts in one request", async () => {
    const w = await setup();
    const model = await modelWith(w, ["GRA"]);
    const url = `/api/infrastructure/project/${w.p1.id}/hosts`;
    const res = await w.call(w.owner, "POST", url, {
      modelId: model.id,
      region: "GRA",
      quantity: 3,
    });
    expect(res.status, res.text).toBe(200);
    expect(res.json.hosts.map((h: { label: string }) => h.label)).toEqual([
      "ADVANCE-2 256 GB GRA #1",
      "ADVANCE-2 256 GB GRA #2",
      "ADVANCE-2 256 GB GRA #3",
    ]);
    expect(res.json.hosts[0]).toMatchObject({
      status: "planned",
      model: { name: "ADVANCE-2" },
      totals: { vmCount: 0 },
    });
    const next = await w.call(w.owner, "POST", url, {
      modelId: model.id,
      region: "GRA",
    });
    expect(next.json.hosts).toHaveLength(1);
    expect(next.json.hosts[0].label).toBe("ADVANCE-2 256 GB GRA #4");
  });

  it("validates quantity and the custom label", async () => {
    const w = await setup();
    const model = await modelWith(w, ["GRA"]);
    const url = `/api/infrastructure/project/${w.p1.id}/hosts`;
    const body = { modelId: model.id, region: "GRA" };
    for (const bad of [
      { quantity: 51 },
      { quantity: 0 },
      { quantity: 1.5 },
      { quantity: 2, label: "Custom" },
    ]) {
      const res = await w.call(w.owner, "POST", url, { ...body, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await db.select().from(schema.infraHostTable)).toHaveLength(0);
    const ok = await w.call(w.owner, "POST", url, {
      ...body,
      quantity: 1,
      label: "Custom",
    });
    expect(ok.json.hosts[0].label).toBe("Custom");
    const max = await w.call(w.owner, "POST", url, { ...body, quantity: 50 });
    expect(max.json.hosts).toHaveLength(50);
    expect(
      await db
        .select()
        .from(schema.infraHostTable)
        .where(eq(schema.infraHostTable.region, "GRA")),
    ).toHaveLength(51);
  });

  it("creates nothing when the region is not offered by the model", async () => {
    const w = await setup();
    const model = await modelWith(w, ["GRA"]);
    const res = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p1.id}/hosts`,
      { modelId: model.id, region: "PAR", quantity: 3 },
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_REGION_NOT_ALLOWED");
    expect(await db.select().from(schema.infraHostTable)).toHaveLength(0);
  });
});
