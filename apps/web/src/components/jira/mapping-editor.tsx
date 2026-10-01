import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { MappingFieldsSection } from "./mapping-fields-section";
import { MappingGeneralSection } from "./mapping-general-section";
import { MappingLabelsSection } from "./mapping-labels-section";
import {
  cleanConfig,
  configsEqual,
  effectiveScalar,
  inheritedValue,
  type MappingLevel,
  validateConfig,
} from "./mapping-model";
import { MappingStatusesSection } from "./mapping-statuses-section";
import { MappingUsersSection } from "./mapping-users-section";
import { useJiraEditorData } from "./use-jira-editor-data";

export type MappingEditorProps = {
  level: MappingLevel;
  // The level's own stored config.
  config: JiraMappingConfig;
  // The levels above it, merged, with the origin of every value.
  parent?: ResolvedJiraMapping;
  readOnly: boolean;
  workspaceId: string;
  projectId?: string;
  onSave: (config: JiraMappingConfig) => Promise<unknown>;
  saving?: boolean;
};

// Editor of one mapping level. The draft lives here; the caller remounts it
// (a new `key`) when the stored mapping is replaced.
export function MappingEditor({
  level,
  config,
  parent,
  readOnly,
  workspaceId,
  projectId,
  onSave,
  saving = false,
}: MappingEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<JiraMappingConfig>(() =>
    structuredClone(config),
  );

  const projectKey = effectiveScalar(
    draft.jiraProjectKey,
    inheritedValue(parent?.jiraProjectKey),
  );
  const issueTypeId = effectiveScalar(
    draft.issueTypeId,
    inheritedValue(parent?.issueTypeId),
  );
  const data = useJiraEditorData({
    level,
    workspaceId,
    projectId,
    projectKey,
    issueTypeId,
  });

  const issues = useMemo(() => validateConfig(level, draft), [level, draft]);
  const dirty = !configsEqual(level, draft, config);
  const canSave = !readOnly && dirty && issues.length === 0 && !saving;

  const sectionProps = {
    config: draft,
    parent,
    data,
    readOnly,
    onChange: setDraft,
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void onSave(cleanConfig(level, draft));
      }}
    >
      {readOnly && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("settings:jiraIntegration.mapping.readOnlyNotice")}
        </p>
      )}

      <MappingGeneralSection {...sectionProps} />
      <MappingFieldsSection {...sectionProps} issues={issues} />
      {level !== "user" && (
        <MappingStatusesSection {...sectionProps} issues={issues} />
      )}
      <MappingUsersSection {...sectionProps} issues={issues} />
      <MappingLabelsSection {...sectionProps} issues={issues} />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave}>
            {saving
              ? t("settings:jiraIntegration.mapping.saving")
              : t("settings:jiraIntegration.mapping.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => setDraft(structuredClone(config))}
          >
            {t("settings:jiraIntegration.mapping.discard")}
          </Button>
          {issues.length > 0 && (
            <p role="alert" className="text-xs text-destructive-foreground">
              {t("settings:jiraIntegration.mapping.fixIssues")}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
