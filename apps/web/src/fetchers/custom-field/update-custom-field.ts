import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateCustomFieldRequest = {
  id: string;
} & InferRequestType<(typeof client)["custom-field"][":id"]["$patch"]>["json"];

// Plain validation errors are text; a conflict (an option that tasks still
// use, a hidden workspace field made required) is JSON `{ code, message }`.
// Either way the person should read the message, not the JSON.
function readErrorMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
  } catch {
    // Not JSON: keep the text as is.
  }
  return body;
}

async function updateCustomField({
  id,
  name,
  required,
  defaultValue,
  options,
  optionColors,
}: UpdateCustomFieldRequest) {
  const response = await client["custom-field"][":id"].$patch({
    param: { id },
    json: { name, required, defaultValue, options, optionColors },
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      readErrorMessage(await response.text()),
    );
  }

  return response.json();
}

export default updateCustomField;
