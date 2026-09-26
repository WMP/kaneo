import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type GetWorkspaceWorkloadRequest = {
  workspaceId: string;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
};

async function getWorkspaceWorkload({
  workspaceId,
  from,
  to,
}: GetWorkspaceWorkloadRequest) {
  const response = await client.workload[":workspaceId"].$get({
    param: { workspaceId },
    query: { from, to },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceWorkload;
