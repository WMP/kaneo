// The lifetime of an invitation and the number of pending invitations a
// workspace may hold. `auth.ts` hands both to Better Auth's organization plugin
// (`invitationExpiresIn`, `invitationLimit`) and the project invitation routes,
// which write the invitation row themselves, use the very same values, so the
// two ways of inviting cannot drift apart. The numbers are Better Auth's own
// defaults; the tests compare an invitation of each kind.
export const INVITATION_EXPIRES_IN_SECONDS = 48 * 60 * 60;
export const PENDING_INVITATION_LIMIT = 100;

export function newInvitationExpiry(): Date {
  return new Date(Date.now() + INVITATION_EXPIRES_IN_SECONDS * 1000);
}
