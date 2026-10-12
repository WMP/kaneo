import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";

// The role editor saves through Better Auth's `update-role`. The new
// `infrastructure` and `datacenter` statements must be accepted there and then
// honoured by the API, not only when a test writes the role row directly.
const origin = "http://localhost:5173";
const { app } = createApp();

async function request(
  method: string,
  path: string,
  body: unknown,
  cookie = "",
) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signup(email: string) {
  const result = await request("POST", "/api/auth/sign-up/email", {
    name: "Role editor test",
    email,
    password: "long-password-for-tests",
  });
  expect(result.status).toBe(200);
  const body = await result.json();
  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: body.user.id as string, cookie };
}

beforeEach(() => resetTestDatabase());

it("saves infrastructure and datacenter permissions through the role editor and enforces them", async () => {
  const owner = await signup("owner@example.com");
  const admin = await signup("admin@example.com");
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: "infra-role-workspace",
      name: "Workspace",
      slug: "infra-roles",
      createdAt: new Date(),
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values([
    {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "owner",
      joinedAt: new Date(),
    },
    {
      workspaceId: workspace.id,
      userId: admin.id,
      role: "admin",
      joinedAt: new Date(),
    },
  ]);
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId: workspace.id,
    role: "admin",
    permission: JSON.stringify(defaultRolePayloads.admin),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const dcHosts = () =>
    request(
      "GET",
      `/api/infrastructure/workspace/${workspace.id}/hosts`,
      undefined,
      admin.cookie,
    );

  // The stored default admin role does not carry the new statements.
  expect((await dcHosts()).status).toBe(403);

  const save = await request(
    "POST",
    "/api/auth/organization/update-role",
    {
      organizationId: workspace.id,
      roleName: "admin",
      data: {
        permission: {
          ...defaultRolePayloads.admin,
          infrastructure: ["read", "plan", "manage"],
          datacenter: ["read"],
        },
      },
    },
    owner.cookie,
  );
  expect(save.status).toBe(200);

  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
  expect(JSON.parse(row?.permission ?? "{}")).toMatchObject({
    infrastructure: ["read", "plan", "manage"],
    datacenter: ["read"],
  });

  const listed = await dcHosts();
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual([]);

  // `datacenter:read` does not include `manage`.
  const status = await request(
    "PUT",
    `/api/infrastructure/workspace/${workspace.id}/hosts/unknown/status`,
    { status: "installed" },
    admin.cookie,
  );
  expect(status.status).toBe(403);
});
