import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function getCustomFieldsByProject({
  projectId,
  includeHidden,
}: {
  projectId: string;
  // true returns every inherited workspace field (hidden ones included, with
  // their real per-project hidden state) plus the project's own fields, for
  // the project's field-visibility editor. Omitted/false returns the
  // effective set (workspace non-hidden + project own) used everywhere else.
  includeHidden?: boolean;
}) {
  const response = await client["custom-field"].project[":projectId"].$get({
    param: { projectId },
    query: includeHidden ? { includeHidden: "true" } : {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getCustomFieldsByProject;
