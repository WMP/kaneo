import { RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { JiraMappingOrigin } from "@/fetchers/jira-integration/types";
import { OriginBadge } from "./mapping-controls";

// A row that only an upper level defines. It applies unchanged; the person can
// copy it into their own level to change it, or disable it here.
export function InheritedRow({
  origin,
  summary,
  onOverride,
  onDisable,
  readOnly,
}: {
  origin: JiraMappingOrigin;
  summary: ReactNode;
  onOverride: () => void;
  onDisable: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1 text-sm">{summary}</div>
      <OriginBadge origin={origin} />
      {!readOnly && (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onOverride}
          >
            {t("settings:jiraIntegration.mapping.override")}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onDisable}>
            {t("settings:jiraIntegration.mapping.disable")}
          </Button>
        </div>
      )}
    </li>
  );
}

// The own level removes an inherited row.
export function DisabledRow({
  summary,
  onRestore,
  readOnly,
}: {
  summary: ReactNode;
  onRestore: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
      <div className="min-w-0 flex-1 text-sm text-muted-foreground line-through">
        {summary}
      </div>
      <Badge variant="warning" size="sm">
        {t("settings:jiraIntegration.mapping.disabledHere")}
      </Badge>
      {!readOnly && (
        <Button type="button" variant="outline" size="xs" onClick={onRestore}>
          <RotateCcw />
          {t("settings:jiraIntegration.mapping.restore")}
        </Button>
      )}
    </li>
  );
}

// A row of the own level. `overrides` names the level whose row it replaces.
export function OwnRowFrame({
  overrides,
  invalid,
  onRemove,
  readOnly,
  children,
}: {
  overrides?: JiraMappingOrigin;
  invalid?: string | null;
  onRemove: () => void;
  readOnly: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const originLabel = overrides
    ? {
        default: t("settings:jiraIntegration.mapping.origin.default"),
        workspace: t("settings:jiraIntegration.mapping.origin.workspace"),
        project: t("settings:jiraIntegration.mapping.origin.project"),
        user: t("settings:jiraIntegration.mapping.origin.user"),
      }[overrides]
    : null;

  return (
    <li className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
      {(originLabel || !readOnly) && (
        <div className="flex items-center justify-between gap-2">
          {originLabel ? (
            <Badge variant="info" size="sm">
              {t("settings:jiraIntegration.mapping.overrides", {
                origin: originLabel,
              })}
            </Badge>
          ) : (
            <span />
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                overrides
                  ? t("settings:jiraIntegration.mapping.removeOverride")
                  : t("settings:jiraIntegration.mapping.remove")
              }
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
      {children}
      {invalid && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {invalid}
        </p>
      )}
    </li>
  );
}

export function SectionShell({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-sidebar p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
