import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// KAN-AUTH-003: every task write route checks its task permission itself.
// The caller is a real project member whose role lacks the permission, so the
// workspace and project access checks pass and only the permission middleware
// can refuse. Each case ends with a positive control: the workspace owner
// sends the same request and it works, so the 403 is not caused by a bad
// request. Routes, middleware and PostgreSQL are real; only publishEvent and
// notification delivery are replaced.
const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: publish,
}));
vi.mock(
  "../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: vi.fn(async () => null) }),
);

const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_KEY_PREFIX",
] as const;
const savedS3 = new Map<string, string | undefined>();

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  for (const name of S3_VARIABLES) savedS3.set(name, process.env[name]);
  process.env.S3_ENDPOINT = "https://storage.example.test";
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
  delete process.env.S3_KEY_PREFIX;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of S3_VARIABLES) {
    const value = savedS3.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

type World = Awaited<ReturnType<typeof setupWorld>>;

async function setupWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    members: "none",
  });
  const { project: otherProject } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    members: "none",
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Original title",
      description: "Original description",
      number: 1,
      status: "to-do",
      priority: "low",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-05T00:00:00.000Z"),
      baselineStartDate: new Date("2025-12-01T00:00:00.000Z"),
      baselineDueDate: new Date("2025-12-05T00:00:00.000Z"),
    })
    .returning();
  if (!task) throw new Error("seed failed");
  // New tasks claim the next number, so it must not collide with the seed.
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: 1 })
    .where(eq(schema.projectTable.id, project.id));

  const projectMember = async (role: string) => {
    const user = await addWorkspaceMember(owner.workspace.id, role);
    await addProjectMember(project.id, user.id, role);
    return user;
  };
  const viewer = await projectMember("viewer");
  // The move also needs task:create in the destination project. Give the viewer
  // that there, so that only the source-project task:update check can refuse.
  await addProjectMember(otherProject.id, viewer.id, "member");
  return {
    owner: owner.user,
    workspaceId: owner.workspace.id,
    project,
    otherProject,
    task,
    viewer,
    member: await projectMember("member"),
  };
}

const storedTask = (id: string) =>
  db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });

async function countRows(
  table: typeof schema.taskTable | typeof schema.assetTable,
) {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

// Everything a refused write must leave alone.
async function snapshot(world: World) {
  return {
    task: await storedTask(world.task.id),
    assignees: await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, world.task.id)),
    tasks: await countRows(schema.taskTable),
    assets: await countRows(schema.assetTable),
  };
}

type Case = {
  name: string;
  permission: string;
  method: "POST" | "PUT" | "DELETE";
  path: (world: World) => string;
  body?: (world: World) => unknown;
  // Roles that hold project access but not the permission.
  denied: ("viewer" | "member")[];
  prepare?: () => void;
  // The stored effect of the successful positive-control request.
  applied: (
    world: World,
    before: Awaited<ReturnType<typeof snapshot>>,
  ) => Promise<void>;
};

const imageKey = (world: World) =>
  `workspace/${world.workspaceId}/project/${world.project.id}/task/${world.task.id}/descriptions/pic.png`;

const cases: Case[] = [
  {
    name: "PUT /api/task/status/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/status/${w.task.id}`,
    body: () => ({ status: "done" }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.status).toBe("done");
    },
  },
  {
    name: "PUT /api/task/title/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/title/${w.task.id}`,
    body: () => ({ title: "Renamed" }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.title).toBe("Renamed");
    },
  },
  {
    name: "PUT /api/task/description/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/description/${w.task.id}`,
    body: () => ({ description: "Rewritten" }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.description).toBe("Rewritten");
    },
  },
  {
    name: "PUT /api/task/priority/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/priority/${w.task.id}`,
    body: () => ({ priority: "high" }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.priority).toBe("high");
    },
  },
  {
    name: "PUT /api/task/due-date/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/due-date/${w.task.id}`,
    body: () => ({ dueDate: "2026-02-10T00:00:00.000Z" }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.dueDate?.toISOString()).toBe(
        "2026-02-10T00:00:00.000Z",
      );
    },
  },
  {
    name: "PUT /api/task/approval/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/approval/${w.task.id}`,
    body: () => ({ approvalStatus: "approved", approvalNote: "ok" }),
    denied: ["viewer"],
    applied: async (w) => {
      const stored = await storedTask(w.task.id);
      expect(stored?.approvalStatus).toBe("approved");
      expect(stored?.approvalNote).toBe("ok");
    },
  },
  {
    name: "PUT /api/task/move/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/move/${w.task.id}`,
    body: (w) => ({ destinationProjectId: w.otherProject.id }),
    denied: ["viewer"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.projectId).toBe(w.otherProject.id);
    },
  },
  {
    name: "POST /api/task/{id}/baseline",
    permission: "task:update",
    method: "POST",
    path: (w) => `/api/task/${w.task.id}/baseline`,
    denied: ["viewer"],
    applied: async (w) => {
      const stored = await storedTask(w.task.id);
      expect(stored?.baselineStartDate?.toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );
      expect(stored?.baselineDueDate?.toISOString()).toBe(
        "2026-01-05T00:00:00.000Z",
      );
    },
  },
  {
    name: "DELETE /api/task/{id}/baseline",
    permission: "task:update",
    method: "DELETE",
    path: (w) => `/api/task/${w.task.id}/baseline`,
    denied: ["viewer"],
    applied: async (w) => {
      const stored = await storedTask(w.task.id);
      expect(stored?.baselineStartDate).toBeNull();
      expect(stored?.baselineDueDate).toBeNull();
    },
  },
  {
    name: "PUT /api/task/image-upload/{id}",
    permission: "task:update",
    method: "PUT",
    path: (w) => `/api/task/image-upload/${w.task.id}`,
    body: () => ({
      filename: "pic.png",
      contentType: "image/png",
      size: 1234,
      surface: "description",
    }),
    denied: ["viewer"],
    applied: async () => {},
  },
  {
    name: "POST /api/task/image-upload/{id}/finalize",
    permission: "task:update",
    method: "POST",
    path: (w) => `/api/task/image-upload/${w.task.id}/finalize`,
    body: (w) => ({
      key: imageKey(w),
      filename: "pic.png",
      contentType: "image/png",
      size: 1234,
      surface: "description",
    }),
    denied: ["viewer"],
    prepare: () => {
      vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
        ContentLength: 1234,
        ContentType: "image/png",
      } as never);
    },
    applied: async (w, before) => {
      expect(await countRows(schema.assetTable)).toBe(before.assets + 1);
      const [asset] = await db.select().from(schema.assetTable);
      expect(asset?.taskId).toBe(w.task.id);
    },
  },
  {
    name: "POST /api/task/duplicate/{id}",
    permission: "task:create",
    method: "POST",
    path: (w) => `/api/task/duplicate/${w.task.id}`,
    body: () => ({ title: "Copy" }),
    denied: ["viewer"],
    applied: async (_w, before) => {
      expect(await countRows(schema.taskTable)).toBe(before.tasks + 1);
    },
  },
  {
    name: "POST /api/task/import/{projectId}",
    permission: "task:create",
    method: "POST",
    path: (w) => `/api/task/import/${w.project.id}`,
    body: () => ({ tasks: [{ title: "Imported", status: "to-do" }] }),
    denied: ["viewer"],
    applied: async (_w, before) => {
      expect(await countRows(schema.taskTable)).toBe(before.tasks + 1);
    },
  },
  {
    // `member` holds task:update but not task:assign, so this also proves the
    // route asks for the assign permission and not the update one.
    name: "PUT /api/task/assignee/{id}",
    permission: "task:assign",
    method: "PUT",
    path: (w) => `/api/task/assignee/${w.task.id}`,
    body: (w) => ({ userId: w.owner.id }),
    denied: ["viewer", "member"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.userId).toBe(w.owner.id);
    },
  },
  {
    name: "PUT /api/task/{id}/assignees",
    permission: "task:assign",
    method: "PUT",
    path: (w) => `/api/task/${w.task.id}/assignees`,
    body: (w) => ({ userIds: [w.owner.id] }),
    denied: ["viewer", "member"],
    applied: async (w) => {
      expect((await storedTask(w.task.id))?.userId).toBe(w.owner.id);
    },
  },
];

describe("API integration: task write routes check their task permission", () => {
  for (const testCase of cases) {
    for (const role of testCase.denied) {
      it(`${testCase.name}: a project ${role} without ${testCase.permission} gets 403, nothing changes, then the owner succeeds`, async () => {
        const world = await setupWorld();
        testCase.prepare?.();
        const { app } = createApp();
        const send = () =>
          app.request(testCase.path(world), {
            method: testCase.method,
            headers: { "content-type": "application/json" },
            body: testCase.body
              ? JSON.stringify(testCase.body(world))
              : undefined,
          });
        const before = await snapshot(world);

        mockAuthenticatedSession(world[role]);
        const refused = await send();
        expect(refused.status).toBe(403);
        expect(await snapshot(world)).toEqual(before);
        expect(publish).not.toHaveBeenCalled();

        // Positive control: the identical request is valid for the owner.
        mockAuthenticatedSession(world.owner);
        const accepted = await send();
        expect(accepted.status, await accepted.clone().text()).toBe(200);
        await testCase.applied(world, before);
      });
    }
  }
});
