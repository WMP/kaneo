import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { EmailShell, styles } from "./shell";

void React;

export type MemberAddedEmailProps = {
  workspaceName: string;
  inviterName: string;
  role: string;
  workspaceLink: string;
  copy?: MemberAddedEmailCopy;
};

export type MemberAddedEmailCopy = {
  subject: string;
  preview: string;
  title: string;
  subtitle: string;
  cta: string;
  ignore: string;
  footer: string;
};

// Inlined rather than imported from i18n/en-US.json: this package builds with
// tsc, so the import would survive into dist and resolve outside the published
// files at runtime.
export const DEFAULT_MEMBER_ADDED_COPY: MemberAddedEmailCopy = {
  subject: "{{inviterName}} added you to {{workspaceName}} on Kaneo",
  preview: "You were added to {{workspaceName}} on Kaneo",
  title: "You are now in {{workspaceName}}",
  subtitle: "{{inviterName}} added you to {{workspaceName}} as {{role}}.",
  cta: "Open workspace",
  ignore: "If this wasn't expected, you can leave the workspace at any time.",
  footer: "Kaneo workspace",
};

function interpolate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}

const MemberAddedEmail = ({
  workspaceName,
  inviterName,
  role,
  workspaceLink,
  copy = DEFAULT_MEMBER_ADDED_COPY,
}: MemberAddedEmailProps) => {
  const values = { workspaceName, inviterName, role };

  return (
    <EmailShell
      preview={interpolate(copy.preview, values)}
      title={interpolate(copy.title, values)}
      subtitle={interpolate(copy.subtitle, values)}
    >
      <Section>
        <Link style={styles.button} href={workspaceLink}>
          {copy.cta}
        </Link>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

MemberAddedEmail.PreviewProps = {
  workspaceName: "Acme Inc",
  inviterName: "John Doe",
  role: "member",
  workspaceLink: "https://kaneo.app/dashboard/workspace/abc123",
  copy: DEFAULT_MEMBER_ADDED_COPY,
} as MemberAddedEmailProps;

export default MemberAddedEmail;
