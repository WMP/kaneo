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
