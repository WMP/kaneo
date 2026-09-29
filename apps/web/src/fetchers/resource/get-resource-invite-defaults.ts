import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type ResourceInviteProject = {
  id: string;
  name: string;
  /** The resource is assigned in this project: the projects to pre-select. */
  hasAssignments: boolean;
};

// The projects the caller can invite to (the API filters by the caller's
// permissions in each project), the resource's own projects first.
async function getResourceInviteDefaults(
  id: string,
): Promise<ResourceInviteProject[]> {
  const response = await client.resource[":id"]["invite-defaults"].$get({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const { projects } = await response.json();
  return projects;
}

export default getResourceInviteDefaults;
