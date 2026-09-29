import type { QueryClient } from "@tanstack/react-query";

// Who may do what, and who is listed where, depends on workspace roles and
// memberships. Everything that changes one of them (a member's role, a role's
// permissions, removing a member, transferring ownership) drops the project
// capabilities and the people lists read by the project views.
export function invalidateAccessQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["project-access"] }),
    queryClient.invalidateQueries({ queryKey: ["project-members"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-members"] }),
  ]);
}
