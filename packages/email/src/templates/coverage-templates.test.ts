import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import NotificationEmail from "./notification";
import PasswordResetEmail from "./password-reset";
import { resolveEmailLocale } from "./resolve-locale";
import TrialReminderEmail from "./trial-reminder";

describe("resolveEmailLocale", () => {
  it.each([
    [undefined, "en"],
    [null, "en"],
    ["", "en"],
    ["DE", "de"],
    ["vi", "vi"],
    ["ja-JP", "ja"],
    ["de-AT", "de"],
    ["fr-FR", "en"],
    ["xx", "en"],
  ])("maps %s to %s", (input, expected) => {
    expect(resolveEmailLocale(input)).toBe(expected);
  });
});

describe("TrialReminderEmail", () => {
  const html = (daysLeft: number, workspaceName = "Acme") =>
    render(
      createElement(TrialReminderEmail, {
        workspaceName,
        daysLeft,
        billingUrl: "https://kaneo.test/billing",
      }),
    );

  it("announces the end of the trial and read-only mode", async () => {
    for (const days of [0, -2]) {
      const out = await html(days);
      expect(out).toContain("The trial for Acme has ended");
      expect(out).toContain("read-only");
    }
  });

  it("uses the singular form for one day", async () => {
    const out = await html(1);
    expect(out).toContain("1 day left on your Acme trial");
    expect(out).not.toContain("1 days");
    expect(out).toContain("Choose a plan to keep creating");
  });

  it("uses the plural form and links to billing", async () => {
    const out = await html(7);
    expect(out).toContain("7 days left on your Acme trial");
    expect(out).toContain('href="https://kaneo.test/billing"');
  });

  it("escapes HTML in the workspace name", async () => {
    const out = await html(2, "<script>alert(1)</script>");
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("PasswordResetEmail", () => {
  it("greets the user by name in English and links the reset URL", async () => {
    const out = await render(
      createElement(PasswordResetEmail, {
        resetLink: "https://kaneo.test/reset?token=t",
        userName: "Jane",
      }),
    );
    expect(out).toContain(
      "Hi Jane, use the button below to set a new password.",
    );
    expect(out).toContain("This reset link expires in 1 hour.");
    expect(out).toContain("https://kaneo.test/reset?token=t");
  });

  it("uses the generic subtitle without a name", async () => {
    const out = await render(
      createElement(PasswordResetEmail, { resetLink: "https://kaneo.test/r" }),
    );
    expect(out).toContain("Use the button below to set a new password.");
    expect(out).not.toContain("Hi ");
  });

  it.each([
    ["de", "Hallo Jane,"],
    ["vi", "Chào Jane,"],
    ["ja", "Jane さん"],
  ])("greets by name in %s", async (locale, text) => {
    const out = await render(
      createElement(PasswordResetEmail, {
        resetLink: "https://kaneo.test/r",
        userName: "Jane",
        locale,
      }),
    );
    expect(out).toContain(text);
  });

  it.each([
    ["de", "Verwende die Schaltfläche unten"],
    ["vi", "Hãy dùng nút bên dưới"],
    ["ja", "下のボタンから新しいパスワード"],
  ])("uses the default subtitle in %s", async (locale, text) => {
    const out = await render(
      createElement(PasswordResetEmail, {
        resetLink: "https://kaneo.test/r",
        locale,
      }),
    );
    expect(out).toContain(text);
  });

  it("escapes HTML in the user name", async () => {
    const out = await render(
      createElement(PasswordResetEmail, {
        resetLink: "https://kaneo.test/r",
        userName: "<img src=x>",
      }),
    );
    expect(out).not.toContain("<img src=x>");
  });
});

describe("NotificationEmail", () => {
  it("omits the action button without an action URL", async () => {
    const out = await render(
      createElement(NotificationEmail, { title: "T", message: "M" }),
    );
    expect(out).not.toContain("Open in Kaneo");
  });

  it("uses a custom action label and the default one", async () => {
    const custom = await render(
      createElement(NotificationEmail, {
        title: "T",
        message: "M",
        actionUrl: "https://kaneo.test/t/1",
        actionLabel: "View task",
      }),
    );
    expect(custom).toContain("View task");
    expect(custom).toContain('href="https://kaneo.test/t/1"');

    const dflt = await render(
      createElement(NotificationEmail, {
        title: "T",
        message: "M",
        actionUrl: "https://kaneo.test/t/1",
      }),
    );
    expect(dflt).toContain("Open in Kaneo");
  });

  it("escapes HTML in the message", async () => {
    const out = await render(
      createElement(NotificationEmail, {
        title: "T",
        message: "<b>bold</b>",
      }),
    );
    expect(out).not.toContain("<b>bold</b>");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
