import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../apps/api/src/auth";
import * as seats from "../../apps/api/src/billing/controllers/sync-seats";
import db, { schema } from "../../apps/api/src/database";
import {
  addUserToWorkspace,
  undoAddUserToWorkspace,
} from "../../apps/api/src/workspace/direct-add";
import * as ws from "../../apps/api/src/ws";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const { res, status } = error as { res?: Response; status?: number };
    if (!res) throw error;
    return {
      status,
      ...((await res.json()) as { code: string; message: string }),
    };
  }
  throw new Error("expected a rejection");
}

describe("addUserToWorkspace: how Better Auth failures are answered", () => {
  const args = { workspaceId: "w", userId: "u", role: "member" };
  const failWith = (error: unknown) =>
    vi.spyOn(auth.api, "addMember").mockRejectedValue(error as never);

  it("answers 500 MEMBER_NOT_ADDED when no member row comes back", async () => {
    vi.spyOn(auth.api, "addMember").mockResolvedValue(null as never);
    expect(await codeOf(addUserToWorkspace(args))).toMatchObject({
      status: 500,
      code: "MEMBER_NOT_ADDED",
    });
  });

  it("maps 'already a member' to 409 and the member limit to 403 with Kaneo's codes", async () => {
    failWith(
      new APIError("BAD_REQUEST", {
        code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
        message: "x",
      }),
    );
    expect(await codeOf(addUserToWorkspace(args))).toMatchObject({
      status: 409,
      code: "ALREADY_WORKSPACE_MEMBER",
    });

    failWith(
      new APIError("FORBIDDEN", {
        code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
        message: "x",
      }),
    );
    expect(await codeOf(addUserToWorkspace(args))).toMatchObject({
      status: 403,
      code: "WORKSPACE_MEMBER_LIMIT_REACHED",
    });
  });

  it("passes any other Better Auth refusal on with its status, code and message, and rethrows a non-API error unchanged", async () => {
    failWith(
      new APIError("BAD_REQUEST", { code: "SOMETHING_ELSE", message: "Nope" }),
    );
    expect(await codeOf(addUserToWorkspace(args))).toEqual({
      status: 400,
      code: "SOMETHING_ELSE",
      message: "Nope",
    });

    failWith(new APIError("BAD_REQUEST", {}));
    expect(await codeOf(addUserToWorkspace(args))).toEqual({
      status: 400,
      code: "MEMBER_NOT_ADDED",
      message: "The member could not be added",
    });

    const boom = new Error("database down");
    failWith(boom);
    await expect(addUserToWorkspace(args)).rejects.toBe(boom);
  });
});

describe("undoAddUserToWorkspace", () => {
  it("removes the member row and tolerates failing socket closing and seat sync", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const [person] = await db
      .insert(schema.userTable)
      .values({
        id: "added-person",
        email: "added@example.com",
        emailVerified: true,
        name: "Added",
      })
      .returning();
    const [member] = await db
      .insert(schema.workspaceUserTable)
      .values({
        workspaceId: owner.workspace.id,
        userId: person.id,
        role: "member",
        joinedAt: new Date(),
      })
      .returning();
    vi.spyOn(ws, "closeUserWorkspaceConnections").mockRejectedValue(
      new Error("socket close failed"),
    );
    vi.spyOn(seats, "syncWorkspaceSeats").mockRejectedValue(
      new Error("seat sync failed"),
    );

    await undoAddUserToWorkspace({
      workspaceId: owner.workspace.id,
      userId: person.id,
      memberId: member.id,
    });

    expect(
      await db.query.workspaceUserTable.findFirst({
        where: eq(schema.workspaceUserTable.id, member.id),
      }),
    ).toBeUndefined();
    // The owner is untouched.
    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(1);
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Seat sync after undoing a member add failed:",
        expect.any(Error),
      ),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Closing the sockets after undoing a member add failed:",
      expect.any(Error),
    );
  });

  it("logs and does not throw when the removal itself fails, leaving the member row", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const [person] = await db
      .insert(schema.userTable)
      .values({
        id: "stuck-person",
        email: "stuck@example.com",
        emailVerified: true,
        name: "Stuck",
      })
      .returning();
    const [member] = await db
      .insert(schema.workspaceUserTable)
      .values({
        workspaceId: owner.workspace.id,
        userId: person.id,
        role: "member",
        joinedAt: new Date(),
      })
      .returning();
    await db.execute(
      sql.raw(
        "CREATE FUNCTION cov_block_member_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delete blocked'; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER cov_block_member_delete BEFORE DELETE ON workspace_member FOR EACH ROW EXECUTE FUNCTION cov_block_member_delete()",
      ),
    );
    try {
      await expect(
        undoAddUserToWorkspace({
          workspaceId: owner.workspace.id,
          userId: person.id,
          memberId: member.id,
        }),
      ).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `Undoing the add of ${person.id} to workspace ${owner.workspace.id} failed`,
        ),
        expect.anything(),
      );
      expect(
        await db.query.workspaceUserTable.findFirst({
          where: eq(schema.workspaceUserTable.id, member.id),
        }),
      ).toBeDefined();
    } finally {
      await db.execute(
        sql.raw("DROP TRIGGER cov_block_member_delete ON workspace_member"),
      );
      await db.execute(sql.raw("DROP FUNCTION cov_block_member_delete()"));
    }
  });
});
