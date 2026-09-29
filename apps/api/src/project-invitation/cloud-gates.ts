import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { isCloud } from "../utils/is-cloud";
import { isDisposableEmail } from "../utils/is-disposable-email";
import { INVITATION_ERROR_CODES, invitationError } from "./delegation";

// Guest (anonymous) accounts may not send invitations on cloud. One predicate
// for the routes and for the capability the web reads.
export function isCloudGuest(
  user: { isAnonymous?: boolean | null } | null | undefined,
): boolean {
  return isCloud() && Boolean(user?.isAnonymous);
}

// The same gates Better Auth's `invite-member` gets on cloud (`hooks.before`
// in auth.ts): the phishing incident of 2026-05-28 used throwaway accounts and
// disposable addresses, and these routes would otherwise be a way around them.
// Applied to creating an invitation and to re-sending one (Better Auth's
// re-send is an `invite-member` call and passes the same gate).
export async function assertCloudInvitationAllowed(
  actorUserId: string,
  email: string,
): Promise<void> {
  if (!isCloud()) return;
  const [actor] = await db
    .select({ isAnonymous: schema.userTable.isAnonymous })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, actorUserId))
    .limit(1);
  if (isCloudGuest(actor)) {
    throw invitationError(
      403,
      INVITATION_ERROR_CODES.guest,
      "Guest accounts may not send workspace invitations.",
    );
  }
  if (isDisposableEmail(email)) {
    throw invitationError(
      400,
      INVITATION_ERROR_CODES.disposableEmail,
      "Invitations to disposable-email addresses are not allowed.",
    );
  }
}
