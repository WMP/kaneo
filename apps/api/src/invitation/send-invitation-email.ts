import { sendWorkspaceInvitationEmail } from "@kaneo/email";
import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { getInvitationEmailSubject } from "../utils/get-invitation-email-subject";
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

async function getUserLocale(email: string): Promise<string | null> {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
  return user?.locale ?? null;
}

export function getInvitationLink(invitationId: string): string {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl.replace(/\/+$/, "")}/invitation/accept/${invitationId}`;
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
      "Invitation created but email not sent due to SMTP not being configured",
    );
    return "not-configured";
  }
  return "sent";
}
