import type { QueryClient } from "@tanstack/react-query";

const USER_PROFILE_QUERY_KEYS = [
  // People lists of the project views and the workspace-level views.
  ["project-members"],
  ["workspace-members"],
  ["workspace", "full"],
  ["activities"],
  ["tasks"],
  ["task"],
] as const;

export async function invalidateUserProfileQueries(queryClient: QueryClient) {
  await Promise.all(
    USER_PROFILE_QUERY_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export default invalidateUserProfileQueries;
