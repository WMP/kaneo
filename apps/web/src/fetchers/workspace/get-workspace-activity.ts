import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type GetWorkspaceActivityParams = {
  workspaceId: string;
  userId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

async function getWorkspaceActivity({
  workspaceId,
  userId,
  type,
  from,
  to,
  page,
  limit,
}: GetWorkspaceActivityParams) {
  const response = await client.workspace[":workspaceId"].activity.$get({
    param: { workspaceId },
    query: {
      ...(userId ? { userId } : {}),
      ...(type ? { type } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(page ? { page: String(page) } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceActivity;
