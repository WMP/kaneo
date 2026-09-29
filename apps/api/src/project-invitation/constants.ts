// Better Auth's own defaults for `invite-member`, which auth.ts does not
// override (`invitationExpiresIn`, `invitationLimit`). The project invitation
// routes create the invitation row themselves, so they must apply the same
// values; `tests/api-integration/project-invitation.test.ts` compares the
// expiry with a Better Auth invitation. Change both together if auth.ts ever
// configures either option.
export const INVITATION_EXPIRES_IN_MS = 48 * 60 * 60 * 1000;
export const PENDING_INVITATION_LIMIT = 100;

export function newInvitationExpiry(): Date {
  return new Date(Date.now() + INVITATION_EXPIRES_IN_MS);
}
