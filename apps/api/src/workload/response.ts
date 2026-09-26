import { responseTimestamp, z } from "../openapi";

export const workloadBucketSchema = z
  .object({
    start: responseTimestamp,
    end: responseTimestamp.openapi({
      description: "Exclusive end of the bucket's 7-day window.",
    }),
  })
  .openapi("WorkloadBucket");

export const workloadAssigneeSchema = z
  .object({
    userId: z.string().nullable().openapi({
      description: "The assignee, or null for the unassigned row.",
    }),
    name: z.string().nullable().openapi({
      description:
        "The assignee's display name, or null for the unassigned row; the caller supplies its own label for it.",
    }),
    image: z.string().nullable(),
    counts: z.array(z.number().int().nonnegative()).openapi({
      description:
        "Dated, not-done tasks active in each bucket, aligned by index with `buckets`. A task with a start and due date spanning several buckets is counted in every one it touches.",
    }),
  })
  .openapi("WorkloadAssignee");

export const workloadResponseSchema = z
  .object({
    buckets: z.array(workloadBucketSchema),
    assignees: z.array(workloadAssigneeSchema),
    truncated: z.boolean().openapi({
      description:
        "True when the number of matching tasks hit the safety cap and results are incomplete. Narrow the date range to see everything.",
    }),
  })
  .openapi("WorkspaceWorkload");
