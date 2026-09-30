import { useTranslation } from "react-i18next";

export type ActorVia = "mcp" | "api" | null | undefined;

// A muted hint after the actor's name that tells the same person's web UI
// changes apart from those made through MCP or an API key, for example
// "(MCP · …a1b2)" or "(API · kaneo_ab…)". The hint is only the short, non-secret
// token hint the API returns. Renders nothing for the web UI and older rows.
export function ActorSource({
  via,
  hint,
}: {
  via: ActorVia;
  hint?: string | null;
}) {
  const { t } = useTranslation();
  if (via !== "mcp" && via !== "api") {
    return null;
  }

  const label =
    via === "mcp" ? t("activity:actorVia.mcp") : t("activity:actorVia.api");
  const text = hint
    ? t("activity:actorVia.suffixWithHint", { via: label, hint })
    : t("activity:actorVia.suffix", { via: label });

  return (
    <span
      data-testid="activity-actor-source"
      className="whitespace-nowrap text-muted-foreground text-xs"
    >
      {text}
    </span>
  );
}
