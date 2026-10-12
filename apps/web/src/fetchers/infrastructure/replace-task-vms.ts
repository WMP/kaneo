import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type TaskVmInput = {
  id?: string;
  name: string;
  vcpu: number;
  ramGb: number;
  cephStorageGb: number;
  localStorageGb: number;
  hostId: string | null;
  storageClusterId: string | null;
};

async function replaceTaskVms({
  taskId,
  vms,
}: {
  taskId: string;
  vms: TaskVmInput[];
}) {
  const response = await client.infrastructure.task[":taskId"].vms.$put({
    param: { taskId },
    json: { vms },
  });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default replaceTaskVms;
