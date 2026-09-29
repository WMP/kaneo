import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { sendInvitationEmail } from "../invitation/send-invitation-email";

export type EmailDelivery = { emailAttempted: boolean; emailSent: boolean };

export const EMAIL_NOT_ATTEMPTED: EmailDelivery = {
  emailAttempted: false,
  emailSent: false,
};

// Sends the invitation email outside any transaction. The invitation exists
// whatever happens here, so a failing relay is logged and reported in the
// response instead of failing the request; the inviter can re-send.
export async function deliverInvitationEmail({
  invitationId,
  email,
  workspaceId,
  inviterUserId,
}: {
  invitationId: string;
  email: string;
  workspaceId: string;
  inviterUserId: string;
}): Promise<EmailDelivery> {
  try {
    const [inviter] = await db
      .select({ name: schema.userTable.name, email: schema.userTable.email })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, inviterUserId))
      .limit(1);
    const [workspace] = await db
      .select({ name: schema.workspaceTable.name })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId))
      .limit(1);
    if (!inviter || !workspace) return EMAIL_NOT_ATTEMPTED;

    const outcome = await sendInvitationEmail({
      invitationId,
      email,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      workspaceName: workspace.name,
    });
    return outcome === "sent"
      ? { emailAttempted: true, emailSent: true }
      : EMAIL_NOT_ATTEMPTED;
  } catch (error) {
    console.error("Project invitation email failed:", error);
    return { emailAttempted: true, emailSent: false };
  }
}
