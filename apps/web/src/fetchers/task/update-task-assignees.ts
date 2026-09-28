import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

async function updateTaskAssignees(
  taskId: string,
  userIds: string[],
  resourceIds: string[] = [],
) {
  const response = await client.task[":id"].assignees.$put({
    param: { id: taskId },
    json: { userIds, resourceIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default updateTaskAssignees;
