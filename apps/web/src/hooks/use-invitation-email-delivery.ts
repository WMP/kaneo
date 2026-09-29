import useGetConfig from "@/hooks/queries/config/use-get-config";

/**
 * Whether the server emails invitations.
 * - "sent": SMTP is configured, so an invitation email goes out.
 * - "not-sent": SMTP is not configured; the link is the only delivery channel.
 * - "unknown": the config is still loading or failed to load. Copy for this
 *   state must claim neither that an email was sent nor that none was.
 */
export type InvitationEmailDelivery = "sent" | "not-sent" | "unknown";

export function useInvitationEmailDelivery(): InvitationEmailDelivery {
  const { data: config } = useGetConfig();
  if (config?.hasSmtp === true) return "sent";
  if (config?.hasSmtp === false) return "not-sent";
  return "unknown";
}

type InvitationEmailMessage = "created" | "shareLink" | "renewed";

// Static keys so the i18n tooling still sees every string in use.
const MESSAGE_KEYS = {
  created: {
    sent: "team:inviteModal.success",
    "not-sent": "team:inviteModal.successNoEmail",
    unknown: "team:inviteModal.successUnknownEmail",
  },
  shareLink: {
    sent: "team:inviteModal.shareLinkDescription",
    "not-sent": "team:inviteModal.shareLinkDescriptionNoEmail",
    unknown: "team:inviteModal.shareLinkDescriptionUnknownEmail",
  },
  renewed: {
    sent: "team:invitations.resendSuccess",
    "not-sent": "team:invitations.renewSuccess",
    unknown: "team:invitations.renewSuccessUnknownEmail",
  },
} as const satisfies Record<
  InvitationEmailMessage,
  Record<InvitationEmailDelivery, string>
>;

/** Copy for an invitation outcome that depends on whether email is sent. */
export function getInvitationEmailMessageKey(
  message: InvitationEmailMessage,
  delivery: InvitationEmailDelivery,
): string {
  return MESSAGE_KEYS[message][delivery];
}
