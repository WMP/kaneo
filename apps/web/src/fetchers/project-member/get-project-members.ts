import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function fetchProjectMembers(projectId: string) {
  const response = await client.project[":projectId"].members.$get({
    param: { projectId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

// The rows as the API lists them, for the members settings section.
export type ProjectMember = Awaited<
  ReturnType<typeof fetchProjectMembers>
>[number];
export type ProjectMemberRow = ProjectMember;

// The shape the assignee and mention pickers already consume (the Better Auth
// member list: `{ members: [{ userId, role, user }] }`), built from the project
// members. Rows without effective access (`active: false`) are left out.
export type ProjectPerson = {
  id: string;
  userId: string;
  role: string;
  source: ProjectMemberRow["source"];
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

export function toProjectPeople(rows: ProjectMemberRow[]): {
  members: ProjectPerson[];
} {
  return {
    members: rows
      .filter((row) => row.active)
      .map((row) => ({
        id: row.userId,
        userId: row.userId,
        role: row.role,
        source: row.source,
        user: {
          id: row.userId,
          name: row.name,
          email: row.email,
          image: row.image,
        },
      })),
  };
}

async function getProjectMembers(projectId: string) {
  return toProjectPeople(await fetchProjectMembers(projectId));
}

export { fetchProjectMembers };
export default getProjectMembers;
