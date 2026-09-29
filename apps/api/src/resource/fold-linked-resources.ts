import getWorkspaceMembers from "../workspace/controllers/get-workspace-members";

// The fold rule of the workload: a person resource linked to an account counts
// in the ACCOUNT's row, but only for a caller who may see that account under the
// member-visibility rule (`getWorkspaceMembers`). For anybody else the resource
// keeps a row of its own (the resource's name, no account data), so the view
// never confirms who a resource is linked to. The aggregate view and the tasks
// drill-through both decide with this one function.
export function foldTargetId(
  resource: { id: string; userId: string | null },
  visibleAccountIds: ReadonlySet<string>,
): string {
  return resource.userId && visibleAccountIds.has(resource.userId)
    ? resource.userId
    : resource.id;
}

// Which of these accounts the caller may see (the members list rules, resolved
// for just these accounts).
export async function loadVisibleAccountIds(
  workspaceId: string,
  viewerUserId: string,
  viewerProjectIds: string[] | null,
  accountIds: string[],
): Promise<Set<string>> {
  const members = await getWorkspaceMembers(
    workspaceId,
    viewerUserId,
    viewerProjectIds,
    { userIds: accountIds },
  );
  return new Set(members.map((member) => member.id));
}
