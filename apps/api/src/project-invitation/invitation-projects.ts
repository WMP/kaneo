import { and, eq } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";
import { invitationError } from "./delegation";

// The database (or a transaction of it) a write runs on.
export type Executor = Pick<typeof db, "select" | "insert">;

// Adds (or re-roles) one project of an invitation. An invitation row may only
// name a project of the INVITATION'S workspace: a project of another workspace
// would let acceptance create a membership there. Acceptance filters by
// workspace again, because a project can move after the row was written.
export async function upsertInvitationProject(
  executor: Executor,
  {
    invitationId,
    workspaceId,
    projectId,
    role,
  }: {
    invitationId: string;
    workspaceId: string;
    projectId: string;
    role: string;
  },
): Promise<void> {
  const [project] = await executor
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!project) {
    throw invitationError(
      400,
      "PROJECT_NOT_IN_WORKSPACE",
      "The project does not belong to the invitation's workspace",
    );
  }

  await executor
    .insert(schema.invitationProjectTable)
    .values({ invitationId, projectId, role })
    .onConflictDoUpdate({
      target: [
        schema.invitationProjectTable.invitationId,
        schema.invitationProjectTable.projectId,
      ],
      set: { role },
    });
}
