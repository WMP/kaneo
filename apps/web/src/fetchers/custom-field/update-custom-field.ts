import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateCustomFieldRequest = {
  id: string;
} & InferRequestType<(typeof client)["custom-field"][":id"]["$patch"]>["json"];

async function updateCustomField({
  id,
  name,
  optionColors,
}: UpdateCustomFieldRequest) {
  const response = await client["custom-field"][":id"].$patch({
    param: { id },
    json: { name, optionColors },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateCustomField;
