import { fillEmailCopy } from "./email-copy";
import { getWorkspaceInvitationEmailCopy } from "./get-workspace-invitation-email-copy";

export function getInvitationEmailSubject(
  locale: string | null,
  inviterName: string,
  workspaceName: string,
) {
  return fillEmailCopy(getWorkspaceInvitationEmailCopy(locale).subject, {
    inviterName,
    workspaceName,
  });
}
