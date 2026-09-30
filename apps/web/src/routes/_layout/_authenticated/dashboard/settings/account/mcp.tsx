import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { McpCodeBlock } from "@/components/settings/mcp-code-block";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { getApiUrl } from "@/fetchers/get-api-url";
import { buildMcpConnection } from "@/lib/mcp-connection";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/mcp",
)({
  component: McpSettings,
});

const DOCS_URL = "https://kaneo.app/docs/core/integrations/mcp";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardPanel className="min-w-0 space-y-3">{children}</CardPanel>
    </Card>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function McpSettings() {
  const { t } = useTranslation();
  const connection = buildMcpConnection(getApiUrl("/mcp"));

  return (
    <>
      <PageTitle title={t("settings:mcpPage.pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:mcpPage.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:mcpPage.subtitle")}
          </p>
        </div>

        <Section
          title={t("settings:mcpPage.serverUrl.title")}
          description={t("settings:mcpPage.serverUrl.description")}
        >
          <McpCodeBlock
            label={t("settings:mcpPage.serverUrl.title")}
            value={connection.mcpUrl}
          />
        </Section>

        <Section
          title={t("settings:mcpPage.claudeCode.title")}
          description={t("settings:mcpPage.claudeCode.description")}
        >
          <McpCodeBlock
            label={t("settings:mcpPage.claudeCode.title")}
            value={connection.claudeCodeAdd}
          />
          <Note>{t("settings:mcpPage.claudeCode.afterAdd")}</Note>
          <McpCodeBlock
            label={t("settings:mcpPage.claudeCode.allowedToolsLabel")}
            value={connection.claudeCodeAllowedTools}
          />
          <Note>{t("settings:mcpPage.claudeCode.allowedToolsNote")}</Note>
        </Section>

        <Section
          title={t("settings:mcpPage.codex.title")}
          description={t("settings:mcpPage.codex.description")}
        >
          <McpCodeBlock
            label={t("settings:mcpPage.codex.addLabel")}
            value={connection.codexAdd}
          />
          <McpCodeBlock
            label={t("settings:mcpPage.codex.loginLabel")}
            value={connection.codexLogin}
          />
          <Note>{t("settings:mcpPage.codex.configNote")}</Note>
          <McpCodeBlock
            label={t("settings:mcpPage.codex.configLabel")}
            value={connection.codexConfigToml}
          />
        </Section>

        <Section
          title={t("settings:mcpPage.desktop.title")}
          description={t("settings:mcpPage.desktop.description")}
        >
          <Note>{t("settings:mcpPage.desktop.steps")}</Note>
          <Note>{t("settings:mcpPage.desktop.note")}</Note>
        </Section>

        <Section
          title={t("settings:mcpPage.cursor.title")}
          description={t("settings:mcpPage.cursor.description")}
        >
          <McpCodeBlock
            label={t("settings:mcpPage.cursor.title")}
            value={connection.cursorJson}
          />
        </Section>

        <Section
          title={t("settings:mcpPage.stdio.title")}
          description={t("settings:mcpPage.stdio.description")}
        >
          <McpCodeBlock
            label={t("settings:mcpPage.stdio.title")}
            value={connection.stdioInstall}
          />
          <Note>{t("settings:mcpPage.stdio.note")}</Note>
        </Section>

        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("settings:mcpPage.docsLink")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </>
  );
}
