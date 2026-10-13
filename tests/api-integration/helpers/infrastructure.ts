import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./fixtures";

type TestUser = Parameters<typeof mockAuthenticatedSession>[0];

export async function defineRole(
  workspaceId: string,
  role: string,
  permissions: Record<string, string[]>,
) {
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission: JSON.stringify(permissions),
  });
}

export function infraClient() {
  const { app } = createApp();
  return async function call(
    user: unknown,
    method: string,
    path: string,
    body?: unknown,
  ) {
    mockAuthenticatedSession(user as TestUser);
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // plain text error
    }
    // Tests index into the parsed body freely.
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    return { status: response.status, json: json as any, text };
  };
}

export const modelBody = (overrides: Record<string, unknown> = {}) => ({
  name: "ADVANCE-2",
  provider: "ovh",
  family: "ADVANCE",
  ramGb: 256,
  vcpu: 32,
  storageGb: 4000,
  regions: ["GRA", "PAR"],
  leadTimeDays: 14,
  hypervisorReservePercent: 5,
  ...overrides,
});

// Region codes that the existing tests use; models, hosts and clusters may only
// name regions of the workspace catalog.
export const DEFAULT_REGIONS = ["GRA", "PAR", "SBG", "PAR-2", "WAW"];

export async function seedRegions(
  workspaceId: string,
  codes: string[] = DEFAULT_REGIONS,
) {
  await db.insert(schema.infraRegionTable).values(
    codes.map((code, position) => ({
      workspaceId,
      code,
      name: code,
      position,
    })),
  );
}

let taskNumber = 0;

export async function insertTask(projectId: string, columnId: string) {
  taskNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Migration task ${taskNumber}`,
      number: taskNumber,
      status: "to-do",
      columnId,
    })
    .returning();
  return task;
}

// A workspace with an owner and two projects (P1 with a task, P2 with a task),
// where only the owner has access (full access through the owner role).
export async function infraWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  await seedRegions(workspaceId);
  const p1 = await createProjectFixture({ workspaceId, members: "none" });
  const p2 = await createProjectFixture({
    workspaceId,
    name: "Second project",
    members: "none",
  });
  const task1 = await insertTask(p1.project.id, p1.columns.todo.id);
  const task2 = await insertTask(p2.project.id, p2.columns.todo.id);
  return {
    call: infraClient(),
    owner: owner.user,
    workspaceId,
    p1: p1.project,
    p2: p2.project,
    task1,
    task2,
  };
}

// A user with the given WORKSPACE role; with `projectRole` they are also a
// member of the project with that PROJECT role.
export async function userWith(
  workspaceId: string,
  workspaceRole: string,
  project?: { id: string; role: string },
) {
  const user = await addWorkspaceMember(workspaceId, workspaceRole);
  if (project) await addProjectMember(project.id, user.id, project.role);
  return user;
}
