import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { OriginBadge, SimpleSelect, TagListInput } from "./mapping-controls";
import { inheritedValue } from "./mapping-model";
import { SectionShell } from "./mapping-row";
import type { JiraEditorData } from "./use-jira-editor-data";

// Jira project key, issue type and default components. A blank value inherits
// the upper level's value, which is shown next to the input.
export function MappingGeneralSection({
  config,
  parent,
  data,
  readOnly,
  onChange,
}: {
  config: JiraMappingConfig;
  parent: ResolvedJiraMapping | undefined;
  data: JiraEditorData;
  readOnly: boolean;
  onChange: (config: JiraMappingConfig) => void;
}) {
  const { t } = useTranslation();
  const inheritedKey = inheritedValue(parent?.jiraProjectKey);
  const inheritedIssueType = inheritedValue(parent?.issueTypeId);
  const inheritedIssueTypeName = inheritedValue(parent?.issueTypeName);
  const inheritedComponents = inheritedValue(parent?.components);

  const projectOptions = (data.projects ?? []).map((project) => ({
    value: project.key,
    label: `${project.key} - ${project.name}`,
  }));
  const issueTypeOptions = (data.issueTypes ?? []).map((type) => ({
    value: type.id,
    label: type.name,
  }));

  const ownKey = config.jiraProjectKey ?? "";
  const ownIssueType = config.issueTypeId ?? "";

  return (
    <SectionShell
      title={t("settings:jiraIntegration.mapping.generalTitle")}
      description={t("settings:jiraIntegration.mapping.generalDescription")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium">
            {t("settings:jiraIntegration.mapping.projectKey")}
          </p>
          {data.projects ? (
            <SimpleSelect
              value={ownKey}
              options={projectOptions}
              disabled={readOnly}
              placeholder={
                inheritedKey
                  ? t("settings:jiraIntegration.mapping.inheritedValue", {
                      value: String(inheritedKey.value),
                    })
                  : t("settings:jiraIntegration.mapping.selectPlaceholder")
              }
              ariaLabel={t("settings:jiraIntegration.mapping.projectKey")}
              onChange={(key) =>
                // A new project invalidates the issue type chosen for the old one.
                onChange({
                  ...config,
                  jiraProjectKey: key,
                  issueTypeId: undefined,
                  issueTypeName: undefined,
                })
              }
            />
          ) : (
            <Input
              size="sm"
              value={ownKey}
              disabled={readOnly}
              aria-label={t("settings:jiraIntegration.mapping.projectKey")}
              placeholder={
                inheritedKey
                  ? t("settings:jiraIntegration.mapping.inheritedValue", {
                      value: String(inheritedKey.value),
                    })
                  : t("settings:jiraIntegration.mapping.projectKeyPlaceholder")
              }
              onChange={(event) =>
                onChange({ ...config, jiraProjectKey: event.target.value })
              }
            />
          )}
          {!ownKey && inheritedKey && (
            <OriginBadge origin={inheritedKey.origin} />
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium">
            {t("settings:jiraIntegration.mapping.issueType")}
          </p>
          {data.issueTypes ? (
            <SimpleSelect
              value={ownIssueType}
              options={issueTypeOptions}
              disabled={readOnly}
              placeholder={
                inheritedIssueType
                  ? t("settings:jiraIntegration.mapping.inheritedValue", {
                      value: String(
                        inheritedIssueTypeName?.value ??
                          inheritedIssueType.value,
                      ),
                    })
                  : t("settings:jiraIntegration.mapping.selectPlaceholder")
              }
              ariaLabel={t("settings:jiraIntegration.mapping.issueType")}
              onChange={(id) =>
                onChange({
                  ...config,
                  issueTypeId: id,
                  issueTypeName: data.issueTypes?.find((type) => type.id === id)
                    ?.name,
                })
              }
            />
          ) : (
            <div className="flex gap-2">
              <Input
                size="sm"
                value={ownIssueType}
                disabled={readOnly}
                aria-label={t("settings:jiraIntegration.mapping.issueTypeId")}
                placeholder={
                  inheritedIssueType
                    ? t("settings:jiraIntegration.mapping.inheritedValue", {
                        value: String(inheritedIssueType.value),
                      })
                    : t(
                        "settings:jiraIntegration.mapping.issueTypeIdPlaceholder",
                      )
                }
                onChange={(event) =>
                  onChange({ ...config, issueTypeId: event.target.value })
                }
              />
              <Input
                size="sm"
                value={config.issueTypeName ?? ""}
                disabled={readOnly}
                aria-label={t("settings:jiraIntegration.mapping.issueTypeName")}
                placeholder={t(
                  "settings:jiraIntegration.mapping.issueTypeNamePlaceholder",
                )}
                onChange={(event) =>
                  onChange({ ...config, issueTypeName: event.target.value })
                }
              />
            </div>
          )}
          {!ownIssueType && inheritedIssueType && (
            <OriginBadge origin={inheritedIssueType.origin} />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">
          {t("settings:jiraIntegration.mapping.components")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings:jiraIntegration.mapping.componentsHint")}
        </p>
        <TagListInput
          value={config.components ?? []}
          disabled={readOnly}
          suggestions={data.components?.map((component) => component.name)}
          ariaLabel={t("settings:jiraIntegration.mapping.components")}
          placeholder={t(
            "settings:jiraIntegration.mapping.componentsPlaceholder",
          )}
          onChange={(components) =>
            onChange({
              ...config,
              components: components.length > 0 ? components : undefined,
            })
          }
        />
        {(config.components ?? []).length === 0 && inheritedComponents && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{(inheritedComponents.value as string[]).join(", ")}</span>
            <OriginBadge origin={inheritedComponents.origin} />
          </div>
        )}
      </div>
    </SectionShell>
  );
}
