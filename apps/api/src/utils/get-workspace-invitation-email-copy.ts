import deDE from "../../../../i18n/de-DE.json";
import enUS from "../../../../i18n/en-US.json";
import frFR from "../../../../i18n/fr-FR.json";
import jaJP from "../../../../i18n/ja-JP.json";
import ptBR from "../../../../i18n/pt-BR.json";
import viVN from "../../../../i18n/vi-VN.json";
import { pickEmailCopy } from "./email-copy";

const messages = {
  de: deDE.invitations.email,
  en: enUS.invitations.email,
  fr: frFR.invitations.email,
  ja: jaJP.invitations.email,
  pt: ptBR.invitations.email,
  vi: viVN.invitations.email,
};

export function getWorkspaceInvitationEmailCopy(locale?: string | null) {
  return pickEmailCopy(messages, "en", locale);
}
