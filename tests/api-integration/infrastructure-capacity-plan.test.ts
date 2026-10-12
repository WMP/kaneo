import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  defineRole,
  infraWorld,
  modelBody,
  userWith,
} from "./helpers/infrastructure";

beforeEach(resetTestDatabase);

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const w = await infraWorld();
  const ws = w.workspaceId;
  await defineRole(ws, "bare", { project: ["read"] });
  await defineRole(ws, "infra_reader", { infrastructure: ["read"] });
  await defineRole(ws, "dc", { datacenter: ["read", "manage"] });
  const dcUser = await userWith(ws, "dc");
  const reader = await userWith(ws, "bare", {
    id: w.p1.id,
    role: "infra_reader",
  });
  const noInfra = await userWith(ws, "bare", { id: w.p1.id, role: "bare" });

  // Tasks start in 40 days (p1) and 5 days (p2): the p2 order is already late.
  await db
    .update(schema.taskTable)
    .set({ startDate: new Date(`${day(40)}T00:00:00.000Z`) })
    .where(eq(schema.taskTable.id, w.task1.id));
  await db
    .update(schema.taskTable)
    .set({ startDate: new Date(`${day(5)}T00:00:00.000Z`) })
    .where(eq(schema.taskTable.id, w.task2.id));

  const hostIds: Record<string, string[]> = { p1: [], p2: [] };
  for (const [key, project] of [
    ["p1", w.p1],
    ["p2", w.p2],
  ] as const) {
    const model = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${project.id}/models`,
      modelBody({ regions: ["GRA", "PAR"] }),
    );
    const count = key === "p1" ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const host = await w.call(
        w.owner,
        "POST",
        `/api/infrastructure/project/${project.id}/hosts`,
        { modelId: model.json.id, region: "PAR" },
      );
      hostIds[key].push(host.json.id);
    }
  }

  const dcBase = `/api/infrastructure/workspace/${ws}`;
  const cluster = await w.call(dcUser, "POST", `${dcBase}/storage-clusters`, {
    name: "Ceph PAR",
    region: "PAR",
    kind: "self_managed",
    ecDataChunks: 4,
    ecCodingChunks: 2,
    leadTimeDays: 30,
  });
  const entry = await w.call(
    dcUser,
    "POST",
    `${dcBase}/storage-clusters/${cluster.json.id}/capacity`,
    {
      capacityGb: 600,
      modelName: "STOR-1",
    },
  );
  await w.call(
    dcUser,
    "PUT",
    `${dcBase}/storage-clusters/${cluster.json.id}/capacity/${entry.json.id}`,
    { status: "installed", availableFrom: day(-10) },
  );

  const vm = (name: string, extra: Record<string, unknown>) => ({
    name,
    vcpu: 2,
    ramGb: 8,
    localStorageGb: 10,
    hostId: null,
    ...extra,
  });
  // 320 GB usable: 200 + 200 Ceph GB across two projects is a shortfall.
  const r1 = await w.call(
    w.owner,
    "PUT",
    `/api/infrastructure/task/${w.task1.id}/vms`,
    {
      vms: [
        vm("p1-vm-a", {
          hostId: hostIds.p1[0],
          cephStorageGb: 200,
          storageClusterId: cluster.json.id,
        }),
        vm("p1-vm-b", { hostId: hostIds.p1[1] }),
        vm("p1-unplaced", {}),
      ],
    },
  );
  expect(r1.status, r1.text).toBe(200);
  const r2 = await w.call(
    w.owner,
    "PUT",
    `/api/infrastructure/task/${w.task2.id}/vms`,
    {
      vms: [
        vm("p2-vm-a", {
          hostId: hostIds.p2[0],
          cephStorageGb: 200,
          storageClusterId: cluster.json.id,
        }),
      ],
    },
  );
  expect(r2.status, r2.text).toBe(200);
  return {
    ...w,
    dcUser,
    reader,
    noInfra,
    dcBase,
    cluster: cluster.json,
    hostIds,
  };
}

describe("project capacity", () => {
  it("returns only this project's hosts and task titles and no cluster capacity", async () => {
    const w = await setup();
    const res = await w.call(
      w.reader,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/capacity`,
    );
    expect(res.status, res.text).toBe(200);
    expect(res.json.today).toBe(day(0));
    expect(res.json.hosts).toHaveLength(2);
    const first = res.json.hosts.find(
      (h: { host: { id: string } }) => h.host.id === w.hostIds.p1[0],
    );
    expect(first.result.needDate).toBe(day(40));
    expect(first.result.orderByDate).toBe(day(26));
    expect(first.result.steps).toHaveLength(1);
    expect(res.json.unplacedVms.map((v: { name: string }) => v.name)).toEqual([
      "p1-unplaced",
    ]);
    expect(res.json.unplacedVms[0].taskTitle).toBe(w.task1.title);
    // Planned hosts started in 40 days with 14 days lead: not late, but not ready.
    expect(
      res.json.warnings.filter(
        (x: { type: string }) => x.type === "HOST_NOT_READY",
      ),
    ).toHaveLength(2);
    expect(res.text).toContain(w.task1.title);
    expect(res.text).not.toContain(w.task2.title);
    expect(res.text).not.toContain("p2-vm-a");
    // The project sees the cluster by id and name only.
    const vmWithCluster = res.json.warnings.find(
      (x: { vmName?: string }) => x.vmName === "p1-vm-a",
    );
    expect(vmWithCluster).toBeTruthy();
    expect(res.text).not.toMatch(
      /usableGb|usableAllGb|shortfall|usedCephGb|ecDataChunks|rawCapacity|STOR-1|clusters/,
    );
  });

  it("enforces infrastructure:read in the project", async () => {
    const w = await setup();
    const url = `/api/infrastructure/project/${w.p1.id}/capacity`;
    expect((await w.call(w.noInfra, "GET", url)).status).toBe(403);
    // A DC role is not a project member.
    expect((await w.call(w.dcUser, "GET", url)).status).toBe(403);
    const other = await infraWorld();
    expect((await other.call(other.owner, "GET", url)).status).toBe(403);
  });
});

describe("workspace capacity and order plan", () => {
  it("returns hosts of all projects, clusters, warnings and a grouped order plan without task titles", async () => {
    const w = await setup();
    const res = await w.call(w.dcUser, "GET", `${w.dcBase}/capacity`);
    expect(res.status, res.text).toBe(200);
    expect(res.json.hosts).toHaveLength(3);
    expect(res.text).not.toContain(w.task1.title);
    expect(res.text).not.toContain(w.task2.title);
    expect(res.text).not.toContain("taskId");

    const rows = res.json.orderPlan;
    const hostRows = rows.filter((r: { type: string }) => r.type === "host");
    // p1: two planned hosts with the same dates group into one row of 2.
    const p1Row = hostRows.find(
      (r: { projectId: string }) => r.projectId === w.p1.id,
    );
    expect(p1Row.quantity).toBe(2);
    expect(p1Row.labels).toHaveLength(2);
    expect(p1Row.late).toBe(false);
    const p2Row = hostRows.find(
      (r: { projectId: string }) => r.projectId === w.p2.id,
    );
    expect(p2Row.quantity).toBe(1);
    expect(p2Row.late).toBe(true);
    expect(p2Row.orderByDate).toBe(day(-9));
    expect(p2Row.projectName).toBe(w.p2.name);

    // Shortfall: 400 GB used, 320 GB usable => 80 GB; one STOR-1 node suggested.
    const storage = rows.find(
      (r: { type: string }) => r.type === "storage_node",
    );
    expect(storage).toMatchObject({
      status: "suggested",
      quantity: 1,
      capacityGb: 600,
      model: "STOR-1",
      clusterName: "Ceph PAR",
      region: "PAR",
    });
    expect(res.json.clusters[0].result.shortfallGb).toBe(80);
    const types = res.json.warnings.map((x: { type: string }) => x.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "CLUSTER_SHORTFALL",
        "ORDER_LATE",
        "HOST_NOT_READY",
      ]),
    );
    const vmWarning = res.json.warnings.find(
      (x: { vmName?: string }) => x.vmName,
    );
    expect(vmWarning.projectName).toBeTruthy();
    // Sorted by order-by date: the late p2 row comes first.
    expect(rows[0].projectId).toBe(w.p2.id);
  });

  it("enforces datacenter:read on the workspace routes", async () => {
    const w = await setup();
    for (const path of [
      `${w.dcBase}/capacity`,
      `${w.dcBase}/order-plan.xlsx`,
    ]) {
      expect((await w.call(w.reader, "GET", path)).status).toBe(403);
      expect((await w.call(w.noInfra, "GET", path)).status).toBe(403);
      const other = await infraWorld();
      expect((await other.call(other.owner, "GET", path)).status).toBe(403);
      expect((await w.call(w.dcUser, "GET", path)).status).toBe(200);
    }
  });

  it("exports the order plan as a workbook", async () => {
    const w = await setup();
    mockAuthenticatedSession(w.dcUser as never);
    const { app } = createApp();
    const res = await app.request(`${w.dcBase}/order-plan.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toMatch(
      new RegExp(`^attachment; filename="order-plan-.+-${day(0)}\\.xlsx"$`),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const sheet = workbook.getWorksheet("Order plan");
    expect(sheet).toBeTruthy();
    const header = ((sheet?.getRow(1).values ?? []) as unknown[]).slice(1);
    expect(header).toEqual([
      "Order by",
      "Needed by",
      "Type",
      "Provider",
      "Region",
      "Model",
      "Family",
      "RAM (GB)",
      "vCPU",
      "Storage (GB)",
      "Quantity",
      "Capacity (GB)",
      "Project",
      "Cluster",
      "Labels",
      "Status",
      "Late",
    ]);
    // 2 host rows (p1 grouped, p2) + 1 storage suggestion.
    expect(sheet?.rowCount).toBe(4);
    expect(sheet?.getRow(2).getCell(1).value).toBeInstanceOf(Date);
    expect(sheet?.getRow(2).getCell(17).value).toBe("yes");
  });
});
