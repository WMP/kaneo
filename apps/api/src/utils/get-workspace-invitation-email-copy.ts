import deDE from "../../../../i18n/de-DE.json";
import enUS from "../../../../i18n/en-US.json";
import frFR from "../../../../i18n/fr-FR.json";
import jaJP from "../../../../i18n/ja-JP.json";
import ptBR from "../../../../i18n/pt-BR.json";
import viVN from "../../../../i18n/vi-VN.json";
import zhTW from "../../../../i18n/zh-TW.json";
import { pickEmailCopy } from "./email-copy";

// Keyed by lower-case locale prefix; the more specific "zh-tw" is listed first.
const bundles = {
  "zh-tw": zhTW,
  de: deDE,
  en: enUS,
  fr: frFR,
  ja: jaJP,
  pt: ptBR,
  vi: viVN,
};

function getBundle(locale?: string | null) {
  return pickEmailCopy(bundles, "en", locale);
}

export function getWorkspaceInvitationEmailCopy(locale?: string | null) {
  return getBundle(locale).invitations.email;
}

export function getInvitationRoleLabel(
  locale: string | null | undefined,
  role: string,
) {
  const labels: Record<string, string> = getBundle(locale).team.roles;

  return role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (Object.hasOwn(labels, name) ? labels[name] : name))
    .join(", ");
}
