import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

// The literal the API accepts in place of a user id to ask for the
// unassigned row's tasks; must match WORKLOAD_UNASSIGNED_ASSIGNEE server-side.
export const WORKLOAD_UNASSIGNED_ASSIGNEE = "unassigned";

export type GetWorkspaceWorkloadTasksRequest = {
  workspaceId: string;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
  /** A user id, or `WORKLOAD_UNASSIGNED_ASSIGNEE` for the unassigned row. */
  assigneeId: string;
  /** Restrict to a single project; omit for the whole workspace. */
  projectId?: string;
};

async function getWorkspaceWorkloadTasks({
  workspaceId,
  from,
  to,
  assigneeId,
  projectId,
}: GetWorkspaceWorkloadTasksRequest) {
  const response = await client.workload[":workspaceId"].tasks.$get({
    param: { workspaceId },
    query: { from, to, assigneeId, ...(projectId ? { projectId } : {}) },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceWorkloadTasks;
