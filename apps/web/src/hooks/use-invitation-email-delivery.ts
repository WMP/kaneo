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
