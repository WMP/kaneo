import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  locale: vi.fn(),
}));

vi.mock("@kaneo/email", () => ({
  sendWorkspaceInvitationEmail: mocks.send,
}));
vi.mock("../../apps/api/src/utils/get-user-locale", () => ({
  getUserLocale: mocks.locale,
}));

import {
  getInvitationLink,
  sendInvitationEmail,
} from "../../apps/api/src/invitation/send-invitation-email";

const input = {
  invitationId: "inv-1",
  email: "invitee@example.com",
  inviterName: "Ada",
  inviterEmail: "ada@example.com",
  workspaceName: "Acme",
};

describe("sendInvitationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KANEO_CLIENT_URL", "https://kaneo.example.com/");
    mocks.locale.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("builds the accept link from the client URL without a doubled slash", () => {
    expect(getInvitationLink("abc")).toBe(
      "https://kaneo.example.com/invitation/accept/abc",
    );
    vi.stubEnv("KANEO_CLIENT_URL", "");
    expect(getInvitationLink("abc")).toBe(
      "http://localhost:5173/invitation/accept/abc",
    );
  });

  it("sends the email and reports it as sent", async () => {
    mocks.send.mockResolvedValue({ success: true });
    await expect(sendInvitationEmail(input)).resolves.toBe("sent");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [to, subject, data] = mocks.send.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(to).toBe("invitee@example.com");
    expect(subject).toContain("Ada");
    expect(subject).toContain("Acme");
    expect(data).toMatchObject({
      inviterName: "Ada",
      inviterEmail: "ada@example.com",
      workspaceName: "Acme",
      to: "invitee@example.com",
      invitationLink: "https://kaneo.example.com/invitation/accept/inv-1",
    });
  });

  it("uses the copy of the invitee's locale", async () => {
    mocks.send.mockResolvedValue({ success: true });
    mocks.locale.mockResolvedValue("de-DE");
    await sendInvitationEmail(input);
    expect(mocks.locale).toHaveBeenCalledWith("invitee@example.com");
    const [, subject] = mocks.send.mock.calls[0] as [string, string];
    expect(subject).toContain("Ada");
    expect(subject).not.toBe("Ada invited you to join Acme on Kaneo");
  });

  it("reports that nothing was sent when SMTP is not configured", async () => {
    mocks.send.mockResolvedValue({
      success: false,
      reason: "SMTP_NOT_CONFIGURED",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(sendInvitationEmail(input)).resolves.toBe("not-configured");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("inv-1");
    // The invitee's address is not logged.
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("invitee@");
  });

  it("rethrows a delivery failure", async () => {
    mocks.send.mockRejectedValue(new Error("relay down"));
    await expect(sendInvitationEmail(input)).rejects.toThrow("relay down");
  });
});
