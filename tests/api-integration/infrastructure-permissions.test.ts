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
  const model = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/models`,
    modelBody(),
  );
  expect(model.status, model.text).toBe(200);
  const host = await w.call(
    w.owner,
    "POST",
    `/api/infrastructure/project/${w.p1.id}/hosts`,
    { modelId: model.json.id, region: "GRA" },
  );
  host.json = host.json.hosts[0];
  const ws = w.workspaceId;
  await defineRole(ws, "bare", { project: ["read"] });
  await defineRole(ws, "infra_reader", { infrastructure: ["read"] });
  await defineRole(ws, "infra_planner", { infrastructure: ["read", "plan"] });
  await defineRole(ws, "dc", { datacenter: ["read", "manage"] });
  await defineRole(ws, "dc_read", { datacenter: ["read"] });

  const p = `/api/infrastructure/project/${w.p1.id}`;
  const dc = `/api/infrastructure/workspace/${ws}/hosts`;
  const modelBodyJson = modelBody({ name: "Other" });
  const requests = {
    read: [
      ["GET", `${p}/models`],
      ["GET", `${p}/hosts`],
      ["GET", `/api/infrastructure/task/${w.task1.id}/vms`],
    ] as [string, string, unknown?][],
    plan: [
      ["POST", `${p}/hosts`, { modelId: model.json.id, region: "PAR" }],
      ["PUT", `${p}/hosts/${host.json.id}`, { label: "renamed" }],
      ["PUT", `/api/infrastructure/task/${w.task1.id}/vms`, { vms: [] }],
    ] as [string, string, unknown?][],
    manage: [
      ["POST", `${p}/models`, modelBodyJson],
      ["PUT", `${p}/models/${model.json.id}`, { name: "x" }],
      ["DELETE", `${p}/models/${model.json.id}`],
      ["DELETE", `${p}/hosts/${host.json.id}`],
    ] as [string, string, unknown?][],
    dcRead: [["GET", dc]] as [string, string, unknown?][],
    dcManage: [
      [
        "PUT",
        `${dc}/${host.json.id}/status`,
        { status: "ordered", availableFrom: "2026-12-01" },
      ],
    ] as [string, string, unknown?][],
  };
  return { ...w, model: model.json, host: host.json, requests };
}

type World = Awaited<ReturnType<typeof setup>>;

async function statuses(
  w: World,
  user: unknown,
  list: [string, string, unknown?][],
) {
  const out: number[] = [];
  for (const [method, path, body] of list) {
    out.push((await w.call(user, method, path, body)).status);
  }
  return out;
}

const all = (n: number, status: number) => Array(n).fill(status);

describe("infrastructure project routes", () => {
  it("answers 403 to a workspace member without the permission", async () => {
    const w = await setup();
    const builtIn = await userWith(w.workspaceId, "member", {
      id: w.p1.id,
      role: "member",
    });
    const bare = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "bare",
    });
    for (const user of [builtIn, bare]) {
      for (const key of ["read", "plan", "manage"] as const) {
        const list = w.requests[key];
        expect(await statuses(w, user, list)).toEqual(all(list.length, 403));
      }
    }
    // Nothing was written by the rejected calls.
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(1);
    expect(await db.select().from(schema.infraHostTable)).toHaveLength(1);
  });

  it("lets a project role with read and plan list and plan, but not manage", async () => {
    const w = await setup();
    // The WORKSPACE role carries nothing: the project role decides.
    const planner = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "infra_planner",
    });
    expect(await statuses(w, planner, w.requests.read)).toEqual(all(3, 200));
    expect(await statuses(w, planner, w.requests.plan)).toEqual(all(3, 200));
    expect(await statuses(w, planner, w.requests.manage)).toEqual(all(4, 403));
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(1);
  });

  it("lets a read-only project role read but not plan", async () => {
    const w = await setup();
    const reader = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "infra_reader",
    });
    expect(await statuses(w, reader, w.requests.read)).toEqual(all(3, 200));
    expect(await statuses(w, reader, w.requests.plan)).toEqual(all(3, 403));
  });

  it("answers 403 to a caller of another workspace on every route", async () => {
    const w = await setup();
    const outsider = await infraWorld();
    for (const key of Object.keys(w.requests) as (keyof typeof w.requests)[]) {
      const list = w.requests[key];
      expect(await statuses(w, outsider.owner, list)).toEqual(
        all(list.length, 403),
      );
    }
    expect(await db.select().from(schema.infraModelTable)).toHaveLength(1);
  });

  it("lets the owner do everything", async () => {
    const w = await setup();
    for (const key of ["read", "plan", "dcRead", "dcManage"] as const) {
      const list = w.requests[key];
      expect(await statuses(w, w.owner, list)).toEqual(all(list.length, 200));
    }
    // manage: create, update, then delete the host and the model (unused once
    // the host is gone; the host is ordered by dcManage, so use a new one).
    const [create, update] = w.requests.manage;
    expect(
      (await w.call(w.owner, create[0], create[1], create[2])).status,
    ).toBe(200);
    expect(
      (await w.call(w.owner, update[0], update[1], update[2])).status,
    ).toBe(200);
  });

  it("does not let a non-member of the project in even with a workspace infrastructure role", async () => {
    const w = await setup();
    await defineRole(w.workspaceId, "ws_infra", {
      infrastructure: ["read", "plan", "manage"],
    });
    const nonMember = await userWith(w.workspaceId, "ws_infra");
    for (const key of ["read", "plan", "manage"] as const) {
      const list = w.requests[key];
      expect(await statuses(w, nonMember, list)).toEqual(all(list.length, 403));
    }
  });
});

describe("datacenter routes", () => {
  it("lets a workspace datacenter role in without project membership, but not into project routes", async () => {
    const w = await setup();
    const dcUser = await userWith(w.workspaceId, "dc");
    expect(await statuses(w, dcUser, w.requests.dcRead)).toEqual([200]);
    expect(await statuses(w, dcUser, w.requests.dcManage)).toEqual([200]);
    for (const key of ["read", "plan", "manage"] as const) {
      const list = w.requests[key];
      expect(await statuses(w, dcUser, list)).toEqual(all(list.length, 403));
    }
    const [host] = await db.select().from(schema.infraHostTable);
    expect(host.status).toBe("ordered");
  });

  it("lets datacenter:read list but not change a status", async () => {
    const w = await setup();
    const reader = await userWith(w.workspaceId, "dc_read");
    expect(await statuses(w, reader, w.requests.dcRead)).toEqual([200]);
    expect(await statuses(w, reader, w.requests.dcManage)).toEqual([403]);
    const [host] = await db.select().from(schema.infraHostTable);
    expect(host.status).toBe("planned");
  });

  it("answers 403 to a project role with infrastructure but no workspace datacenter", async () => {
    const w = await setup();
    await defineRole(w.workspaceId, "infra_all", {
      infrastructure: ["read", "plan", "manage"],
      datacenter: ["read", "manage"],
    });
    // The project role grants datacenter, the workspace role does not: the
    // datacenter resource is always judged by the workspace role.
    const member = await userWith(w.workspaceId, "bare", {
      id: w.p1.id,
      role: "infra_all",
    });
    expect(await statuses(w, member, w.requests.read)).toEqual(all(3, 200));
    expect(await statuses(w, member, w.requests.dcRead)).toEqual([403]);
    expect(await statuses(w, member, w.requests.dcManage)).toEqual([403]);
  });
});
