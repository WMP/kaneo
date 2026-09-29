import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

async function getProjectAccess(projectId: string) {
  const response = await client.project[":projectId"].access.$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export type ProjectAccess = Awaited<ReturnType<typeof getProjectAccess>>;
export type ProjectCapabilities = ProjectAccess["capabilities"];

export default getProjectAccess;
