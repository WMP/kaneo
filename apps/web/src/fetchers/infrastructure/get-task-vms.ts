import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getTaskVms(taskId: string) {
  const response = await client.infrastructure.task[":taskId"].vms.$get({
    param: { taskId },
  });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type InfraVm = Awaited<ReturnType<typeof getTaskVms>>[number];

export default getTaskVms;
