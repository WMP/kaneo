import enUS from "../../../../i18n/en-US.json";
import plPL from "../../../../i18n/pl-PL.json";
import { fillEmailCopy, pickEmailCopy } from "./email-copy";

// The "you were added to a workspace" email exists in English and Polish; every
// other locale gets the English copy (unlike the invitation email, whose copy
// was translated for six locales before this email existed).
const messages = {
  en: enUS.invitations.memberAddedEmail,
  pl: plPL.invitations.memberAddedEmail,
};

export function getMemberAddedEmailCopy(locale?: string | null) {
  return pickEmailCopy(messages, "en", locale);
}

export function getMemberAddedEmailSubject(
  locale: string | null,
  values: { inviterName: string; workspaceName: string; role: string },
) {
  return fillEmailCopy(getMemberAddedEmailCopy(locale).subject, values);
}
