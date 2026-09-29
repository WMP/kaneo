import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInvitationEmailDelivery } from "./use-invitation-email-delivery";

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
