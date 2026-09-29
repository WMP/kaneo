// Query keys of the project membership screens, kept in one place so every
// mutation invalidates the same set.
// The members settings section reads the API rows. They live under the same
// `["project-members", projectId]` prefix as the people the pickers read
// (`useProjectMembers`), so invalidating that prefix refreshes both.
export const projectMembersPrefixKey = (projectId: string | undefined) =>
  ["project-members", projectId] as const;

export const projectMembersKey = (projectId: string | undefined) =>
  [...projectMembersPrefixKey(projectId), "rows"] as const;

export const projectAssignableRolesKey = (projectId: string | undefined) =>
  ["project-assignable-roles", projectId] as const;

export const projectMemberCandidatesKey = (projectId: string | undefined) =>
  ["project-member-candidates", projectId] as const;

export const projectInvitationsKey = (projectId: string | undefined) =>
  ["project-invitations", projectId] as const;
