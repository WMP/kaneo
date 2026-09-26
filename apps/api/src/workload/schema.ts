import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

export const workloadQuery = z.object({
  from: isoDate.openapi({
    description: "Inclusive start date (YYYY-MM-DD).",
  }),
  to: isoDate.openapi({
    description:
      "Inclusive end date (YYYY-MM-DD). The last weekly bucket may extend a few days past it to complete a full week.",
  }),
});

// The literal the tasks drill-through uses in place of a real user id to ask
// for the unassigned row's tasks.
export const WORKLOAD_UNASSIGNED_ASSIGNEE = "unassigned";

export const workloadTasksQuery = workloadQuery.extend({
  assigneeId: z
    .string()
    .min(1)
    .openapi({
      description: `A workspace member's user id, or the literal "${WORKLOAD_UNASSIGNED_ASSIGNEE}" for tasks with no assignee.`,
    }),
});
