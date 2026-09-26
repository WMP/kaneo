// Shared by every write path that can silently change a task's plan
// (startDate/dueDate/progress/isMilestone/constraint, and baseline) so the
// resulting "task.updated" event carries enough for the activity feed to
// say what actually changed, not just that something did. Only fields that
// differ are included; an unaffected caller (e.g. a status-only edit) omits
// the whole field.
//
// Deliberately NOT a generic "diff these two objects" helper: `before`/
// `after` are often full task rows (e.g. drizzle's `getTableColumns`
// spread), and comparing every shared key would leak unrelated columns
// (title, description, ...) into the audit event, or misfire on a column
// selected differently on each side (see update-task.ts's `description`).
const SCHEDULE_FIELDS = [
  "startDate",
  "dueDate",
  "progress",
  "isMilestone",
  "constraintType",
  "constraintDate",
  "baselineStartDate",
  "baselineDueDate",
] as const;

export type ScheduleFields = Partial<
  Record<
    (typeof SCHEDULE_FIELDS)[number],
    Date | string | number | boolean | null | undefined
  >
>;

export type ScheduleChanges = Record<string, { from: unknown; to: unknown }>;

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

export function buildScheduleChanges(
  before: ScheduleFields,
  after: ScheduleFields,
): ScheduleChanges {
  const changes: ScheduleChanges = {};

  for (const field of SCHEDULE_FIELDS) {
    if (!(field in before) || !(field in after)) continue;

    const fromValue = serializeValue(before[field]);
    const toValue = serializeValue(after[field]);

    if (fromValue !== toValue) {
      changes[field] = { from: fromValue, to: toValue };
    }
  }

  return changes;
}
