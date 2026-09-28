import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function setCustomFieldVisibility({
  projectId,
  fieldId,
  hidden,
}: {
  projectId: string;
  fieldId: string;
  hidden: boolean;
}) {
  const response = await client["custom-field"].project[
    ":projectId"
  ].visibility.$post({
    param: { projectId },
    json: { fieldId, hidden },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setCustomFieldVisibility;
