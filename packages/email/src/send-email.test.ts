import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail }),
}));

import {
  sendMagicLinkEmail,
  sendMemberAddedEmail,
  sendNotificationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendTrialReminderEmail,
  sendWorkspaceInvitationEmail,
} from "./send-email";

const smtpKeys = ["SMTP_HOST", "SMTP_FROM"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of smtpKeys) saved[key] = process.env[key];
  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.SMTP_FROM = "Kaneo <noreply@kaneo.test>";
  sendMail.mockReset();
  sendMail.mockResolvedValue({ accepted: [] });
});

afterEach(() => {
  for (const key of smtpKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

const mail = () =>
  sendMail.mock.calls[0][0] as {
    from: string;
    to: string;
    subject: string;
    html: string;
  };

describe("fire-and-forget senders", () => {
  it("sends a magic link email with the link in the HTML body", async () => {
    await sendMagicLinkEmail("a@example.test", "Sign in", {
      magicLink: "https://kaneo.test/magic?token=abc",
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mail()).toMatchObject({
      from: "Kaneo <noreply@kaneo.test>",
      to: "a@example.test",
      subject: "Sign in",
    });
    expect(mail().html).toContain("https://kaneo.test/magic?token=abc");
  });

  it("sends an OTP email containing the code", async () => {
    await sendOtpEmail("a@example.test", "Code", { otp: "123456" });
    expect(mail().to).toBe("a@example.test");
    expect(mail().html).toContain("123456");
  });

  it("sends a password reset email containing the reset link", async () => {
    await sendPasswordResetEmail("a@example.test", "Reset", {
      resetLink: "https://kaneo.test/reset?token=t1",
      userName: "Jane",
    });
    expect(mail().subject).toBe("Reset");
    expect(mail().html).toContain("https://kaneo.test/reset?token=t1");
    expect(mail().html).toContain("Jane");
  });

  it("sends a trial reminder email", async () => {
    await sendTrialReminderEmail("a@example.test", "Trial", {
      workspaceName: "Acme",
      daysLeft: 3,
      billingUrl: "https://kaneo.test/billing",
    });
    expect(mail().html).toContain("3 days left on your Acme trial");
    expect(mail().html).toContain("https://kaneo.test/billing");
  });

  it.each([
    [
      "magic link",
      () =>
        sendMagicLinkEmail("a@example.test", "s", { magicLink: "https://x.y" }),
      "Error sending magic link email",
    ],
    [
      "OTP",
      () => sendOtpEmail("a@example.test", "s", { otp: "1" }),
      "Error sending OTP email",
    ],
    [
      "trial reminder",
      () =>
        sendTrialReminderEmail("a@example.test", "s", {
          workspaceName: "W",
          daysLeft: 1,
          billingUrl: "https://x.y",
        }),
      "Error sending trial reminder email",
    ],
  ])("logs and swallows a transport failure for %s", async (_n, run, msg) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("boom");
    sendMail.mockRejectedValue(failure);
    await expect(run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(msg, failure);
  });

  it("logs only safe SMTP details when the password reset transport fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMail.mockRejectedValue(
      Object.assign(new Error("secret@example.test"), {
        code: "EAUTH",
        responseCode: 535,
      }),
    );
    await expect(
      sendPasswordResetEmail("a@example.test", "s", {
        resetLink: "https://x.y",
      }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Error sending password reset email", {
      code: "EAUTH",
      responseCode: 535,
    });
  });

  it("does not send when the password reset template fails to render", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendPasswordResetEmail("a@example.test", "s", null as never),
    ).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Error rendering password reset email");
  });
});

describe("result-returning senders", () => {
  const invitation = {
    workspaceName: "Acme",
    inviterName: "Ann",
    inviterEmail: "ann@example.test",
    invitationLink: "https://kaneo.test/invite/1",
  };
  const added = {
    workspaceName: "Acme",
    inviterName: "Ann",
    role: "member",
    workspaceLink: "https://kaneo.test/w/acme",
  };
  const notification = { title: "Assigned", message: "You got a task" };

  const senders = [
    [
      "invitation",
      () => sendWorkspaceInvitationEmail("b@example.test", "s", invitation),
      "Error sending workspace invitation email",
    ],
    [
      "member added",
      () => sendMemberAddedEmail("b@example.test", "s", added),
      "Error sending member added email",
    ],
    [
      "notification",
      () => sendNotificationEmail("b@example.test", "s", notification),
      "Error sending notification email",
    ],
  ] as const;

  it.each(senders)(
    "%s: reports SMTP_NOT_CONFIGURED without sending",
    async (_n, run) => {
      delete process.env.SMTP_HOST;
      await expect(run()).resolves.toEqual({
        success: false,
        reason: "SMTP_NOT_CONFIGURED",
      });
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it.each(senders)(
    "%s: reports SMTP_NOT_CONFIGURED without a sender address",
    async (_n, run) => {
      delete process.env.SMTP_FROM;
      await expect(run()).resolves.toEqual({
        success: false,
        reason: "SMTP_NOT_CONFIGURED",
      });
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it.each(senders)("%s: sends and returns success", async (_n, run) => {
    await expect(run()).resolves.toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mail()).toMatchObject({ to: "b@example.test", subject: "s" });
  });

  it.each(senders)(
    "%s: logs and rethrows transport failures",
    async (_n, run, msg) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const failure = new Error("relay down");
      sendMail.mockRejectedValue(failure);
      await expect(run()).rejects.toBe(failure);
      expect(error).toHaveBeenCalledWith(msg, failure);
    },
  );

  it("addresses the invitation template to the recipient", async () => {
    await sendWorkspaceInvitationEmail("b@example.test", "s", invitation);
    expect(mail().html).toContain("https://kaneo.test/invite/1");
    expect(mail().html).toContain("b@example.test");
  });
});
