import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateWorkspaceCustomFieldRequest = {
  workspaceId: string;
} & InferRequestType<
  (typeof client)["custom-field"]["workspace"][":workspaceId"]["$post"]
>["json"];

async function createWorkspaceCustomField({
  workspaceId,
  name,
  type,
  required,
  defaultValue,
  options,
  optionColors,
  position,
}: CreateWorkspaceCustomFieldRequest) {
  const response = await client["custom-field"].workspace[":workspaceId"].$post(
    {
      param: { workspaceId },
      json: {
        name,
        type,
        required,
        defaultValue,
        options,
        optionColors,
        position,
      },
    },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createWorkspaceCustomField;
