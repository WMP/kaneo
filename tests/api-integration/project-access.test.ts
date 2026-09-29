import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  accessibleProjectIds,
  fullAccessRoleNames,
  isFullAccess,
  resolveProjectAccess,
  resolveProjectAccesses,
} from "../../apps/api/src/utils/project-access";
import { builtInRoleStatements } from "../../apps/api/src/utils/role-statements";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function build() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const projects = [];
  for (const name of ["one", "two", "three"]) {
    projects.push(
      (
        await createProjectFixture({
          workspaceId,
          members: "none",
          name,
        })
      ).project,
    );
  }
  const [p1, p2, p3] = projects;
  const other = await createWorkspaceMember({ role: "owner" });
  const foreign = (
    await createProjectFixture({
      workspaceId: other.workspace.id,
      members: "none",
    })
  ).project;

  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role: "manager",
    permission: JSON.stringify({
      task: ["read"],
      workspace: ["read", "manage_settings"],
    }),
  });

  const fullAdmin = await addWorkspaceMember(workspaceId, "admin");
  const manager = await addWorkspaceMember(workspaceId, "manager");
  const composite = await addWorkspaceMember(workspaceId, "member,owner");
  const member = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.id, member.id, "member");
  await addProjectMember(p2.id, member.id, "viewer");
  // A row in another workspace's project never counts here.
  await addProjectMember(foreign.id, member.id, "member");
  const unusable = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.id, unusable.id, "deleted-role");
  await addProjectMember(p2.id, unusable.id, "ghost-role");
  await addProjectMember(p3.id, unusable.id, "member");
  const nobody = await addWorkspaceMember(workspaceId, "member");
  const stale = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.id, stale.id, "admin");
  await db
    .delete(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, stale.id));
  const [instanceAdmin] = await db
    .insert(schema.userTable)
    .values({
      id: "instance-admin",
      email: "instance-admin@example.com",
      emailVerified: true,
      name: "Instance admin",
      role: "admin",
    })
    .returning();

  return {
    workspaceId,
    other,
    p1,
    p2,
    p3,
    foreign,
    owner: owner.user,
    fullAdmin,
    manager,
    composite,
    member,
    unusable,
    nobody,
    stale,
    instanceAdmin,
  };
}
type Built = Awaited<ReturnType<typeof build>>;
let w: Built;

beforeEach(async () => {
  await resetTestDatabase();
  w = await build();
});

describe("isFullAccess", () => {
  it("is true for owners, manage_settings roles and instance administrators", async () => {
    for (const user of [w.owner, w.fullAdmin, w.manager, w.composite]) {
      expect(await isFullAccess(user.id, w.workspaceId), user.name).toBe(true);
    }
    // An instance administrator needs no workspace membership.
    expect(await isFullAccess(w.instanceAdmin.id, w.workspaceId)).toBe(true);
  });

  it("is false for ordinary members and for people outside the workspace", async () => {
    for (const user of [w.member, w.unusable, w.nobody, w.stale]) {
      expect(await isFullAccess(user.id, w.workspaceId), user.name).toBe(false);
    }
    expect(await isFullAccess(w.other.user.id, w.workspaceId)).toBe(false);
    expect(await isFullAccess("no-such-user", w.workspaceId)).toBe(false);
  });
});

describe("accessibleProjectIds", () => {
  it("is null (every project) for full-access users", async () => {
    for (const user of [w.owner, w.fullAdmin, w.manager, w.instanceAdmin]) {
      expect(await accessibleProjectIds(user.id, w.workspaceId)).toBeNull();
    }
  });

  it("lists the member's projects of this workspace only", async () => {
    const ids = await accessibleProjectIds(w.member.id, w.workspaceId);
    expect((ids ?? []).slice().sort()).toEqual([w.p1.id, w.p2.id].sort());
  });

  it("skips memberships whose role can never be exercised", async () => {
    // deleted-role and ghost-role no longer resolve; only the valid `member`
    // row on p3 counts.
    expect(await accessibleProjectIds(w.unusable.id, w.workspaceId)).toEqual([
      w.p3.id,
    ]);
  });

  it("is empty for members without rows, stale rows and non-members", async () => {
    expect(await accessibleProjectIds(w.nobody.id, w.workspaceId)).toEqual([]);
    expect(await accessibleProjectIds(w.stale.id, w.workspaceId)).toEqual([]);
    expect(await accessibleProjectIds(w.other.user.id, w.workspaceId)).toEqual(
      [],
    );
  });

  it("is consistent with resolveProjectAccess for every project", async () => {
    for (const user of [w.member, w.unusable, w.nobody, w.stale, w.owner]) {
      const ids = await accessibleProjectIds(user.id, w.workspaceId);
      for (const project of [w.p1, w.p2, w.p3]) {
        const access = await resolveProjectAccess(user.id, project.id);
        expect(access !== null, `${user.name} ${project.name}`).toBe(
          ids === null || ids.includes(project.id),
        );
      }
    }
  });
});

describe("resolveProjectAccess", () => {
  it("gives owners and instance administrators unrestricted full access", async () => {
    expect(await resolveProjectAccess(w.owner.id, w.p1.id)).toEqual({
      workspaceId: w.workspaceId,
      projectId: w.p1.id,
      mode: "full",
      statements: builtInRoleStatements("owner"),
      unrestricted: true,
    });
    expect(await resolveProjectAccess(w.instanceAdmin.id, w.p1.id)).toEqual({
      workspaceId: w.workspaceId,
      projectId: w.p1.id,
      mode: "full",
      statements: null,
      unrestricted: true,
    });
    expect(await resolveProjectAccess(w.composite.id, w.p2.id)).toMatchObject({
      mode: "full",
      unrestricted: true,
    });
  });

  it("gives manage_settings roles full access with their workspace statements", async () => {
    const admin = await resolveProjectAccess(w.fullAdmin.id, w.p3.id);
    expect(admin).toEqual({
      workspaceId: w.workspaceId,
      projectId: w.p3.id,
      mode: "full",
      statements: builtInRoleStatements("admin"),
      unrestricted: false,
    });
    const manager = await resolveProjectAccess(w.manager.id, w.p3.id);
    expect(manager?.mode).toBe("full");
    expect(manager?.statements?.workspace).toContain("manage_settings");
  });

  it("gives a member the statements of their project role", async () => {
    expect(await resolveProjectAccess(w.member.id, w.p1.id)).toEqual({
      workspaceId: w.workspaceId,
      projectId: w.p1.id,
      mode: "member",
      statements: builtInRoleStatements("member"),
      unrestricted: false,
    });
    expect(await resolveProjectAccess(w.member.id, w.p2.id)).toMatchObject({
      mode: "member",
      statements: builtInRoleStatements("viewer"),
    });
    // No row on p3.
    expect(await resolveProjectAccess(w.member.id, w.p3.id)).toBeNull();
  });

  it("denies unusable roles, stale rows, other workspaces and unknown projects", async () => {
    expect(await resolveProjectAccess(w.unusable.id, w.p1.id)).toBeNull();
    expect(await resolveProjectAccess(w.unusable.id, w.p2.id)).toBeNull();
    expect(await resolveProjectAccess(w.unusable.id, w.p3.id)).toMatchObject({
      mode: "member",
    });
    expect(await resolveProjectAccess(w.stale.id, w.p1.id)).toBeNull();
    // A row in another workspace's project does not open this workspace.
    expect(await resolveProjectAccess(w.member.id, w.foreign.id)).toBeNull();
    expect(await resolveProjectAccess(w.owner.id, w.foreign.id)).toBeNull();
    expect(
      await resolveProjectAccess(w.owner.id, "no-such-project"),
    ).toBeNull();
  });
});

describe("catalog rows that do not parse", () => {
  // The built-in admin has workspace:manage_settings. A catalog row for it with
  // unusable content falls back to the built-in role, everywhere.
  it("fall back to the built-in role in every full-access decision", async () => {
    await db.insert(schema.workspaceRoleTable).values([
      { workspaceId: w.workspaceId, role: "admin", permission: "not json" },
      { workspaceId: w.workspaceId, role: "viewer", permission: "" },
      { workspaceId: w.workspaceId, role: "junk", permission: "[1,2" },
    ]);
    const names = await fullAccessRoleNames(w.workspaceId);
    expect(names).toContain("admin");
    expect(names).not.toContain("viewer");
    expect(names).not.toContain("junk");
    // Same answer from the per-user decision and from the access rule.
    expect(await isFullAccess(w.fullAdmin.id, w.workspaceId)).toBe(true);
    expect(await resolveProjectAccess(w.fullAdmin.id, w.p1.id)).toMatchObject({
      mode: "full",
      statements: builtInRoleStatements("admin"),
    });
  });

  it("agree with isFullAccess for every candidate role", async () => {
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: w.workspaceId,
        role: "admin",
        permission: JSON.stringify({ task: ["read"] }),
      },
      { workspaceId: w.workspaceId, role: "broken", permission: "{" },
    ]);
    const names = await fullAccessRoleNames(w.workspaceId);
    // An admin row without manage_settings is no longer full access.
    expect(names).not.toContain("admin");
    for (const role of ["admin", "manager", "member", "viewer", "broken"]) {
      const user = await addWorkspaceMember(w.workspaceId, role);
      expect(await isFullAccess(user.id, w.workspaceId), role).toBe(
        names.includes(role),
      );
    }
  });
});

describe("resolveProjectAccesses", () => {
  it("tolerates duplicate workspace membership rows", async () => {
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: w.workspaceId,
      userId: w.member.id,
      role: "member",
      joinedAt: new Date(),
    });
    const accesses = await resolveProjectAccesses(w.member.id, [
      w.p1.id,
      w.p2.id,
      w.p1.id,
    ]);
    expect(accesses?.map((access) => access.projectId).sort()).toEqual(
      [w.p1.id, w.p2.id].sort(),
    );
  });

  it("is null when any project is unknown or not accessible", async () => {
    expect(
      await resolveProjectAccesses(w.member.id, [w.p1.id, w.p3.id]),
    ).toBeNull();
    expect(
      await resolveProjectAccesses(w.member.id, [w.p1.id, "no-such-project"]),
    ).toBeNull();
    expect(await resolveProjectAccesses(w.member.id, [])).toEqual([]);
  });
});
