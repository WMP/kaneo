import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "./use-invitation-email-delivery";

let config: { hasSmtp: boolean } | undefined;

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

describe("useInvitationEmailDelivery", () => {
  it("is 'sent' only when SMTP is explicitly configured", () => {
    config = { hasSmtp: true };
    expect(renderHook(() => useInvitationEmailDelivery()).result.current).toBe(
      "sent",
    );
  });

  it("is 'not-sent' only when SMTP is explicitly not configured", () => {
    config = { hasSmtp: false };
    expect(renderHook(() => useInvitationEmailDelivery()).result.current).toBe(
      "not-sent",
    );
  });

  it("is 'unknown' while the config is loading or failed", () => {
    config = undefined;
    expect(renderHook(() => useInvitationEmailDelivery()).result.current).toBe(
      "unknown",
    );
  });
});

describe("getInvitationEmailMessageKey", () => {
  it("maps every outcome and delivery state to a key", () => {
    expect(getInvitationEmailMessageKey("created", "sent")).toBe(
      "team:inviteModal.success",
    );
    expect(getInvitationEmailMessageKey("created", "not-sent")).toBe(
      "team:inviteModal.successNoEmail",
    );
    expect(getInvitationEmailMessageKey("created", "unknown")).toBe(
      "team:inviteModal.successUnknownEmail",
    );
    expect(getInvitationEmailMessageKey("shareLink", "unknown")).toBe(
      "team:inviteModal.shareLinkDescriptionUnknownEmail",
    );
    expect(getInvitationEmailMessageKey("renewed", "not-sent")).toBe(
      "team:invitations.renewSuccess",
    );
    expect(getInvitationEmailMessageKey("renewed", "unknown")).toBe(
      "team:invitations.renewSuccessUnknownEmail",
    );
  });

  it("never gives the unknown state a key that claims an email was or was not sent", () => {
    for (const message of ["created", "shareLink", "renewed"] as const) {
      const unknown = getInvitationEmailMessageKey(message, "unknown");
      expect(unknown).not.toBe(getInvitationEmailMessageKey(message, "sent"));
      expect(unknown).not.toBe(
        getInvitationEmailMessageKey(message, "not-sent"),
      );
    }
  });
});
