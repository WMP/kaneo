import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { infraWorld, insertTask, modelBody } from "./helpers/infrastructure";

beforeEach(resetTestDatabase);

async function withModel() {
  const world = await infraWorld();
  const created = await world.call(
    world.owner,
    "POST",
    `/api/infrastructure/project/${world.p1.id}/models`,
    modelBody(),
  );
  expect(created.status, created.text).toBe(200);
  return { ...world, model: created.json };
}

async function newHost(
  w: Awaited<ReturnType<typeof withModel>>,
  region = "GRA",
  body: Record<string, unknown> = {},
) {
  const res = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/hosts`,
    { modelId: w.model.id, region, ...body },
  );
  expect(res.status, res.text).toBe(200);
  return res.json;
}

const hostsInDb = () => db.select().from(schema.infraHostTable);
const vmsInDb = () => db.select().from(schema.infraVmTable);

describe("models", () => {
  it("creates, lists by position, normalizes regions and validates ranges", async () => {
    const w = await withModel();
    expect(w.model.regions).toEqual(["GRA", "PAR"]);
    expect(w.model.hypervisorReservePercent).toBe(5);

    const second = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p1.id}/models`,
      modelBody({ name: "SCALE", regions: [" gra ", "par-2"], ramGb: 512 }),
    );
    expect(second.status).toBe(200);
    expect(second.json.regions).toEqual(["GRA", "PAR-2"]);
    expect(second.json.position).toBe(1);

    const list = await w.call(
      w.owner,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/models`,
    );
    expect(list.json.map((m: { name: string }) => m.name)).toEqual([
      "ADVANCE-2",
      "SCALE",
    ]);

    for (const bad of [
      { regions: [] },
      { regions: ["GRA", "gra"] },
      { regions: ["bad region"] },
      { regions: ["A".repeat(17)] },
      { regions: Array.from({ length: 21 }, (_, i) => `R${i}`) },
      { ramGb: 0 },
      { vcpu: 0 },
      { storageGb: -1 },
      { leadTimeDays: -1 },
      { hypervisorReservePercent: 91 },
      { hypervisorReservePercent: -1 },
      { provider: "aws" },
    ]) {
      const res = await w.call(
        w.owner,
        "POST",
        `/api/infrastructure/project/${w.p1.id}/models`,
        modelBody(bad),
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(2);
  });

  it("answers 404 for a model of another project", async () => {
    const w = await withModel();
    const url = `/api/infrastructure/project/${w.p2.id}/models/${w.model.id}`;
    expect((await w.call(w.owner, "PUT", url, { name: "Hijack" })).status).toBe(
      404,
    );
    expect((await w.call(w.owner, "DELETE", url)).status).toBe(404);
    const [row] = await db.select().from(schema.infraModelTable);
    expect(row.name).toBe("ADVANCE-2");

    const host = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p2.id}/hosts`,
      { modelId: w.model.id, region: "GRA" },
    );
    expect(host.status).toBe(404);
    expect(await hostsInDb()).toHaveLength(0);
  });

  it("refuses to remove a region that a host uses and to delete a used model", async () => {
    const w = await withModel();
    await newHost(w, "PAR");
    const url = `/api/infrastructure/project/${w.p1.id}/models/${w.model.id}`;

    const removed = await w.call(w.owner, "PUT", url, { regions: ["GRA"] });
    expect(removed.status).toBe(409);
    expect(removed.json.code).toBe("INFRA_REGION_IN_USE");
    const [afterRegion] = await db.select().from(schema.infraModelTable);
    expect(afterRegion.regions).toEqual(["GRA", "PAR"]);

    const ok = await w.call(w.owner, "PUT", url, { regions: ["PAR", "SBG"] });
    expect(ok.status).toBe(200);
    expect(ok.json.regions).toEqual(["PAR", "SBG"]);

    const del = await w.call(w.owner, "DELETE", url);
    expect(del.status).toBe(409);
    expect(del.json.code).toBe("INFRA_MODEL_IN_USE");
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(1);
  });

  it("deletes an unused model", async () => {
    const w = await withModel();
    const url = `/api/infrastructure/project/${w.p1.id}/models/${w.model.id}`;
    expect((await w.call(w.owner, "DELETE", url)).status).toBe(200);
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(0);
  });
});

describe("hosts", () => {
  it("creates planned hosts with the default label and the next free number", async () => {
    const w = await withModel();
    const first = await newHost(w, "GRA");
    expect(first.label).toBe("ADVANCE-2 256 GB GRA #1");
    expect(first.status).toBe("planned");
    expect(first.availableFrom).toBeNull();
    const second = await newHost(w, "GRA");
    expect(second.label).toBe("ADVANCE-2 256 GB GRA #2");
    expect((await newHost(w, "PAR")).label).toBe("ADVANCE-2 256 GB PAR #1");
    expect((await newHost(w, "GRA", { label: "Custom" })).label).toBe("Custom");
    // Deleting the highest number frees it; a gap below is not reused.
    await w.call(
      w.owner,
      "DELETE",
      `/api/infrastructure/project/${w.p1.id}/hosts/${first.id}`,
    );
    expect((await newHost(w, "GRA")).label).toBe("ADVANCE-2 256 GB GRA #3");
  });

  it("rejects a region outside the model and persists nothing", async () => {
    const w = await withModel();
    const res = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p1.id}/hosts`,
      { modelId: w.model.id, region: "waw" },
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_REGION_NOT_ALLOWED");
    expect(await hostsInDb()).toHaveLength(0);
  });

  it("renames, changes the region only while planned, and answers 404 across projects", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    const url = `/api/infrastructure/project/${w.p1.id}/hosts/${host.id}`;

    const renamed = await w.call(w.owner, "PUT", url, {
      label: "  Renamed ",
      region: "par",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json.label).toBe("Renamed");
    expect(renamed.json.region).toBe("PAR");

    const bad = await w.call(w.owner, "PUT", url, { region: "WAW" });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INFRA_REGION_NOT_ALLOWED");

    const foreign = `/api/infrastructure/project/${w.p2.id}/hosts/${host.id}`;
    expect((await w.call(w.owner, "PUT", foreign, { label: "x" })).status).toBe(
      404,
    );
    expect((await w.call(w.owner, "DELETE", foreign)).status).toBe(404);

    await db
      .update(schema.infraHostTable)
      .set({ status: "ordered", availableFrom: "2026-12-01" })
      .where(eq(schema.infraHostTable.id, host.id));
    const locked = await w.call(w.owner, "PUT", url, { region: "GRA" });
    expect(locked.status).toBe(409);
    expect(locked.json.code).toBe("INFRA_HOST_LOCKED");
    const [row] = await hostsInDb();
    expect(row.region).toBe("PAR");
    // A rename is still fine once ordered.
    expect(
      (await w.call(w.owner, "PUT", url, { label: "Ordered one" })).status,
    ).toBe(200);
  });

  it("deletes only planned hosts and leaves their VMs unplaced", async () => {
    const w = await withModel();
    const planned = await newHost(w, "GRA");
    const ordered = await newHost(w, "GRA");
    await db
      .update(schema.infraHostTable)
      .set({ status: "ordered", availableFrom: "2026-12-01" })
      .where(eq(schema.infraHostTable.id, ordered.id));
    await w.call(w.owner, "PUT", `/api/infrastructure/task/${w.task1.id}/vms`, {
      vms: [
        { name: "a", vcpu: 2, ramGb: 8, storageGb: 50, hostId: planned.id },
        { name: "b", vcpu: 2, ramGb: 8, storageGb: 50, hostId: ordered.id },
      ],
    });

    const lockedRes = await w.call(
      w.owner,
      "DELETE",
      `/api/infrastructure/project/${w.p1.id}/hosts/${ordered.id}`,
    );
    expect(lockedRes.status).toBe(409);
    expect(lockedRes.json.code).toBe("INFRA_HOST_LOCKED");
    expect(await hostsInDb()).toHaveLength(2);

    const del = await w.call(
      w.owner,
      "DELETE",
      `/api/infrastructure/project/${w.p1.id}/hosts/${planned.id}`,
    );
    expect(del.status).toBe(200);
    expect(await hostsInDb()).toHaveLength(1);
    const vms = await vmsInDb();
    expect(vms).toHaveLength(2);
    expect(vms.find((v) => v.name === "a")?.hostId).toBeNull();
    expect(vms.find((v) => v.name === "b")?.hostId).toBe(ordered.id);
  });

  it("lists hosts with model and VM totals", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    await newHost(w, "PAR");
    await w.call(w.owner, "PUT", `/api/infrastructure/task/${w.task1.id}/vms`, {
      vms: [
        { name: "a", vcpu: 2, ramGb: 8, storageGb: 50, hostId: host.id },
        { name: "b", vcpu: 4, ramGb: 16, storageGb: 100, hostId: host.id },
      ],
    });
    const list = await w.call(
      w.owner,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/hosts`,
    );
    expect(list.status).toBe(200);
    const used = list.json.find((h: { id: string }) => h.id === host.id);
    expect(used.totals).toEqual({
      vmCount: 2,
      vcpu: 6,
      ramGb: 24,
      storageGb: 150,
    });
    expect(used.model.name).toBe("ADVANCE-2");
    const empty = list.json.find((h: { id: string }) => h.id !== host.id);
    expect(empty.totals).toEqual({
      vmCount: 0,
      vcpu: 0,
      ramGb: 0,
      storageGb: 0,
    });
  });
});

describe("task VMs", () => {
  it("replaces the list: update by id, create without id, delete the rest", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    const url = `/api/infrastructure/task/${w.task1.id}/vms`;
    const first = await w.call(w.owner, "PUT", url, {
      vms: [
        { name: "web", vcpu: 2, ramGb: 8, storageGb: 50, hostId: host.id },
        { name: "db", vcpu: 8, ramGb: 64, storageGb: 500, hostId: null },
      ],
    });
    expect(first.status, first.text).toBe(200);
    expect(first.json.map((v: { name: string }) => v.name)).toEqual([
      "web",
      "db",
    ]);
    expect(first.json[0].host.label).toBe("ADVANCE-2 256 GB GRA #1");
    expect(first.json[1].host).toBeNull();

    const web = first.json[0];
    const second = await w.call(w.owner, "PUT", url, {
      vms: [
        { name: "cache", vcpu: 1, ramGb: 4, storageGb: 0, hostId: null },
        { ...web, name: "web-renamed", hostId: null },
      ],
    });
    expect(second.status, second.text).toBe(200);
    expect(second.json.map((v: { name: string }) => v.name)).toEqual([
      "cache",
      "web-renamed",
    ]);
    expect(second.json[1].id).toBe(web.id);
    expect(await vmsInDb()).toHaveLength(2);

    const got = await w.call(w.owner, "GET", url);
    expect(got.json).toHaveLength(2);
    const cleared = await w.call(w.owner, "PUT", url, { vms: [] });
    expect(cleared.json).toEqual([]);
    expect(await vmsInDb()).toHaveLength(0);
  });

  it("rejects a host of another project and keeps the previous list", async () => {
    const w = await withModel();
    const model2 = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p2.id}/models`,
      modelBody(),
    );
    const foreignHost = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p2.id}/hosts`,
      { modelId: model2.json.id, region: "GRA" },
    );
    const url = `/api/infrastructure/task/${w.task1.id}/vms`;
    await w.call(w.owner, "PUT", url, {
      vms: [{ name: "keep", vcpu: 1, ramGb: 1, storageGb: 1, hostId: null }],
    });

    const res = await w.call(w.owner, "PUT", url, {
      vms: [
        { name: "new", vcpu: 1, ramGb: 1, storageGb: 1, hostId: null },
        {
          name: "bad",
          vcpu: 1,
          ramGb: 1,
          storageGb: 1,
          hostId: foreignHost.json.id,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_HOST_NOT_IN_PROJECT");
    const unknown = await w.call(w.owner, "PUT", url, {
      vms: [
        { name: "x", vcpu: 1, ramGb: 1, storageGb: 1, hostId: "no-such-host" },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.json.code).toBe("INFRA_HOST_NOT_IN_PROJECT");
    expect((await vmsInDb()).map((v) => v.name)).toEqual(["keep"]);
  });

  it("rejects an id that is not a VM of this task and more than 200 items", async () => {
    const w = await withModel();
    const other = await w.call(
      w.owner,
      "PUT",
      `/api/infrastructure/task/${w.task2.id}/vms`,
      {
        vms: [{ name: "o", vcpu: 1, ramGb: 1, storageGb: 1, hostId: null }],
      },
    );
    const url = `/api/infrastructure/task/${w.task1.id}/vms`;
    await w.call(w.owner, "PUT", url, {
      vms: [{ name: "mine", vcpu: 1, ramGb: 1, storageGb: 1, hostId: null }],
    });

    const res = await w.call(w.owner, "PUT", url, {
      vms: [
        {
          id: other.json[0].id,
          name: "stolen",
          vcpu: 1,
          ramGb: 1,
          storageGb: 1,
          hostId: null,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INFRA_VM_NOT_IN_TASK");
    expect((await vmsInDb()).map((v) => v.name).sort()).toEqual(["mine", "o"]);

    const item = { name: "v", vcpu: 1, ramGb: 1, storageGb: 1, hostId: null };
    const many = await w.call(w.owner, "PUT", url, {
      vms: Array.from({ length: 201 }, () => item),
    });
    expect(many.status).toBe(400);
    const max = await w.call(w.owner, "PUT", url, {
      vms: Array.from({ length: 200 }, () => item),
    });
    expect(max.status).toBe(200);
    expect(max.json).toHaveLength(200);
  });

  it("rejects negative sizes", async () => {
    const w = await withModel();
    const res = await w.call(
      w.owner,
      "PUT",
      `/api/infrastructure/task/${w.task1.id}/vms`,
      { vms: [{ name: "n", vcpu: -1, ramGb: 1, storageGb: 1, hostId: null }] },
    );
    expect(res.status).toBe(400);
    expect(await vmsInDb()).toHaveLength(0);
  });
});

describe("datacenter status", () => {
  it("lists hosts of every project without task titles and sets statuses", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    await w.call(w.owner, "PUT", `/api/infrastructure/task/${w.task1.id}/vms`, {
      vms: [{ name: "vm1", vcpu: 2, ramGb: 8, storageGb: 50, hostId: host.id }],
    });
    const base = `/api/infrastructure/workspace/${w.workspaceId}/hosts`;
    const list = await w.call(w.owner, "GET", base);
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);
    expect(list.json[0].projectName).toBe(w.p1.name);
    expect(list.json[0].projectId).toBe(w.p1.id);
    expect(list.json[0].totals.vmCount).toBe(1);
    expect(list.text).not.toContain(w.task1.title);
    expect(list.text).not.toContain("vm1");

    const url = `${base}/${host.id}/status`;
    const noDate = await w.call(w.owner, "PUT", url, { status: "ordered" });
    expect(noDate.status).toBe(400);
    expect(noDate.json.code).toBe("INFRA_AVAILABLE_FROM_REQUIRED");
    expect((await hostsInDb())[0].status).toBe("planned");

    const badDate = await w.call(w.owner, "PUT", url, {
      status: "ordered",
      availableFrom: "2026-02-30",
    });
    expect(badDate.status).toBe(400);

    const ordered = await w.call(w.owner, "PUT", url, {
      status: "ordered",
      availableFrom: "2026-12-01",
      hostname: "gra-001",
    });
    expect(ordered.status, ordered.text).toBe(200);
    expect(ordered.json.status).toBe("ordered");
    expect(ordered.json.availableFrom).toBe("2026-12-01");
    expect(ordered.json.hostname).toBe("gra-001");

    const installed = await w.call(w.owner, "PUT", url, {
      status: "installed",
    });
    expect(installed.status).toBe(200);
    expect(installed.json.availableFrom).toBe(
      new Date().toISOString().slice(0, 10),
    );
    expect(installed.json.hostname).toBe("gra-001");
  });

  it("answers 404 for a host of another workspace", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    const other = await infraWorld();
    const res = await other.call(
      other.owner,
      "PUT",
      `/api/infrastructure/workspace/${other.workspaceId}/hosts/${host.id}/status`,
      { status: "ordered", availableFrom: "2026-12-01" },
    );
    expect(res.status).toBe(404);
    expect((await hostsInDb())[0].status).toBe("planned");
  });
});

describe("cascades", () => {
  it("removes VMs with their task and models and hosts with their project", async () => {
    const w = await withModel();
    const host = await newHost(w, "GRA");
    const extraTask = await insertTask(w.p1.id, (await columnOf(w.p1.id)).id);
    for (const task of [w.task1, extraTask]) {
      await w.call(w.owner, "PUT", `/api/infrastructure/task/${task.id}/vms`, {
        vms: [
          {
            name: task.title,
            vcpu: 1,
            ramGb: 1,
            storageGb: 1,
            hostId: host.id,
          },
        ],
      });
    }
    expect(await vmsInDb()).toHaveLength(2);

    await db
      .delete(schema.taskTable)
      .where(eq(schema.taskTable.id, w.task1.id));
    const left = await vmsInDb();
    expect(left).toHaveLength(1);
    expect(left[0].taskId).toBe(extraTask.id);
    expect(await hostsInDb()).toHaveLength(1);

    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, w.p1.id));
    expect(await vmsInDb()).toHaveLength(0);
    expect(await hostsInDb()).toHaveLength(0);
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(0);
  });
});

async function columnOf(projectId: string) {
  const [column] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
  return column;
}
