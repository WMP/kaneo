// What an avatar or name needs from a person.
export type AssigneeProfile = {
  userId: string;
  user: { name: string | null; image: string | null };
};

type PickerMember = {
  userId: string;
  user?: { name?: string | null; image?: string | null } | null;
};

// The person behind a task's assignee id. The project member list only holds
// current project members, so an assignee who left the project (or who lives in
// another project, as on a cross-project relation) is missing from it: fall back
// to the name and image the task itself carries instead of showing nobody.
export function findAssignee(
  members: readonly PickerMember[] | undefined,
  userId: string | null | undefined,
  fallback?: { name?: string | null; image?: string | null },
): AssigneeProfile | undefined {
  if (!userId) return undefined;
  const member = members?.find((candidate) => candidate.userId === userId);
  if (member) {
    return {
      userId,
      user: {
        name: member.user?.name ?? fallback?.name ?? null,
        image: member.user?.image ?? fallback?.image ?? null,
      },
    };
  }
  if (!fallback?.name && !fallback?.image) return undefined;
  return {
    userId,
    user: { name: fallback.name ?? null, image: fallback.image ?? null },
  };
}
