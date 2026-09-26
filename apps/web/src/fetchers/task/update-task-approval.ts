import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type UpdateTaskApprovalJson = InferRequestType<
  (typeof client)["task"]["approval"][":id"]["$put"]
>["json"];

async function updateTaskApproval(
  taskId: string,
  approvalStatus: UpdateTaskApprovalJson["approvalStatus"],
  approvalNote?: string | null,
) {
  const response = await client.task.approval[":id"].$put({
    param: { id: taskId },
    json: { approvalStatus, approvalNote },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default updateTaskApproval;
