import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import db from "../database";
import { taskAssignmentTable } from "../database/schema";

// Postgres caps a statement at 65535 bind parameters; see create-activities.ts
// for the same chunking rule applied to a table that also scales with task
// count.
const INSERT_CHUNK_SIZE = 500;

type BackfillCandidate = {
  task_id: string;
  user_id: string;
};

/**
 * Backfills `ganttpro_task_assignment` — the source of truth for a task's
 * full assignee list — from `task.assignee_id` (the single legacy assignee
 * column, kept as a denormalized "primary assignee" mirror). Covers any task
 * whose assignee predates this table, or that was created by a path not yet
 * updated to mirror into it.
 *
 * Must run after Drizzle `migrate()` so the assignment table exists (see
 * `runStartupTasks`). Safe to run on every boot: the NOT EXISTS guard plus
 * onConflictDoNothing against the table's own unique (task_id, user_id)
 * index make a repeat run a no-op.
 */
export async function migrateTaskAssignments() {
  console.log("🔄 Backfilling task assignments...");

  const missing = await db.execute<BackfillCandidate>(sql`
    SELECT t.id AS task_id, t.assignee_id AS user_id
    FROM "task" t
    WHERE t.assignee_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ganttpro_task_assignment" a
        WHERE a.task_id = t.id AND a.user_id = t.assignee_id
      )
  `);

  const rows = missing.rows;

  if (rows.length === 0) {
    console.log("✅ Task assignments already backfilled.");
    return;
  }

  const values = rows.map((row) => ({
    id: createId(),
    taskId: row.task_id,
    userId: row.user_id,
    units: 100,
  }));

  for (let index = 0; index < values.length; index += INSERT_CHUNK_SIZE) {
    await db
      .insert(taskAssignmentTable)
      .values(values.slice(index, index + INSERT_CHUNK_SIZE))
      .onConflictDoNothing({
        target: [taskAssignmentTable.taskId, taskAssignmentTable.userId],
      });
  }

  console.log(`✅ Backfilled ${rows.length} task assignment(s).`);
}
