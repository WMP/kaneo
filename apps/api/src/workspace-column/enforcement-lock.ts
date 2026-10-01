import { eq } from "drizzle-orm";
import type db from "../database";
import { projectTable, workspaceTable } from "../database/schema";
import { columnsEnforcedError } from "./errors";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Locking protocol (see docs/plans/workspace-columns.md):
// - every workspace column mutation and the enforcement toggle lock the
//   workspace row with `lockWorkspaceForWrite` (FOR NO KEY UPDATE: it conflicts
//   with FOR SHARE like FOR UPDATE does, but does not block the foreign key
//   checks of unrelated inserts that only reference the workspace row);
// - project column mutations, project creation and project move read the flag
//   with FOR SHARE in the same transaction as their write, so they either see
//   the new flag or finish before the toggle starts.
// The workspace row is always locked before any column or task row.

/** Locks the workspace row for a write. `null` when the workspace is gone. */
export async function lockWorkspaceForWrite(
  tx: Transaction,
  workspaceId: string,
): Promise<{ enforced: boolean } | null> {
  const [row] = await tx
    .select({ enforced: workspaceTable.enforceColumns })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .for("no key update");
  return row ?? null;
}

/** Reads the flag under a shared lock. `null` when the workspace is gone. */
export async function readEnforcementShared(
  tx: Transaction,
  workspaceId: string,
): Promise<boolean | null> {
  const [row] = await tx
    .select({ enforced: workspaceTable.enforceColumns })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .for("share");
  return row ? row.enforced : null;
}

/**
 * Refuses a project column mutation (409 WORKSPACE_COLUMNS_ENFORCED) when the
 * project's workspace enforces its columns. Call it first inside the
 * transaction that performs the write.
 */
export async function assertProjectColumnsEditable(
  tx: Transaction,
  projectId: string,
): Promise<void> {
  const [row] = await tx
    .select({ enforced: workspaceTable.enforceColumns })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(projectTable.id, projectId))
    .for("share", { of: workspaceTable });

  if (row?.enforced) throw columnsEnforcedError();
}
