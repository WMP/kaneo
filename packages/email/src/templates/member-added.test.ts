import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import enUS from "../../../../i18n/en-US.json";
import plPL from "../../../../i18n/pl-PL.json";
import MemberAddedEmail from "./member-added";

const props = {
  workspaceName: "Zespół Produktowy",
  inviterName: "Anna",
  role: "member",
  workspaceLink: "https://kaneo.example/dashboard/workspace/abc",
};

describe("MemberAddedEmail", () => {
  it("renders the Polish copy", async () => {
    const html = await render(
      createElement(MemberAddedEmail, {
        ...props,
        copy: plPL.invitations.memberAddedEmail,
      }),
    );

    expect(html).toContain("Jesteś w obszarze Zespół Produktowy");
    expect(html).toContain("Anna dodał(a) Cię do obszaru roboczego");
    expect(html).toContain("z rolą: member");
    expect(html).toContain("Otwórz obszar roboczy");
    expect(html).toContain(
      'href="https://kaneo.example/dashboard/workspace/abc"',
    );
  });

  it("renders without a copy prop so previews and exports work", async () => {
    const html = await render(createElement(MemberAddedEmail, props));

    expect(html).toContain("You are now in Zespół Produktowy");
    expect(html).toContain("Anna added you to Zespół Produktowy as member.");
    expect(html).toContain("Open workspace");
  });

  it("keeps the fallback in sync with the en-US bundle", async () => {
    const html = await render(createElement(MemberAddedEmail, props));
    const withEnUs = await render(
      createElement(MemberAddedEmail, {
        ...props,
        copy: enUS.invitations.memberAddedEmail,
      }),
    );

    expect(html).toBe(withEnUs);
  });
});
