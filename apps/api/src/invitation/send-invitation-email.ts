import { sendWorkspaceInvitationEmail } from "@kaneo/email";
import { getClientUrl } from "../utils/client-url";
import { getInvitationEmailSubject } from "../utils/get-invitation-email-subject";
import { getUserLocale } from "../utils/get-user-locale";
import { getWorkspaceInvitationEmailCopy } from "../utils/get-workspace-invitation-email-copy";

// The single place that builds and sends the invitation email. Better Auth's
// `sendInvitationEmail` option (workspace invitations, re-sends) and the
// project invitation routes both go through it, so the link, subject and copy
// cannot drift apart. The copy names the workspace: the accept page shows the
// projects and roles, and the email templates have no project wording yet.

export type InvitationEmailOutcome =
  | "sent"
  // SMTP is not configured on this instance: nothing was sent and the inviter
  // has to share the accept link themselves.
  | "not-configured";

export function getInvitationLink(invitationId: string): string {
  return `${getClientUrl().replace(/\/+$/, "")}/invitation/accept/${invitationId}`;
}

// Throws when SMTP is configured but delivery fails, as the underlying mail
// helper always did; callers decide whether that fails their request.
export async function sendInvitationEmail({
  invitationId,
  email,
  inviterName,
  inviterEmail,
  workspaceName,
}: {
  invitationId: string;
  email: string;
  inviterName: string;
  inviterEmail: string;
  workspaceName: string;
}): Promise<InvitationEmailOutcome> {
  const locale = await getUserLocale(email);
  const copy = getWorkspaceInvitationEmailCopy(locale);

  const result = await sendWorkspaceInvitationEmail(
    email,
    getInvitationEmailSubject(locale, inviterName, workspaceName),
    {
      inviterEmail,
      inviterName,
      workspaceName,
      invitationLink: getInvitationLink(invitationId),
      to: email,
      copy,
    },
  );

  if (result?.success === false && result.reason === "SMTP_NOT_CONFIGURED") {
    console.warn(
      `Invitation ${invitationId} was created but its email was not sent: SMTP is not configured`,
    );
    return "not-configured";
  }
  return "sent";
}
