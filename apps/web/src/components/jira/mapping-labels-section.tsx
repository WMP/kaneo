import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { SimpleSelect } from "./mapping-controls";
import {
  appendRow,
  disableLabelRow,
  labelRows,
  type MappingIssue,
  overrideLabelRow,
  removeRow,
  updateRow,
} from "./mapping-model";
import {
  DisabledRow,
  InheritedRow,
  OwnRowFrame,
  SectionShell,
} from "./mapping-row";
import type { JiraEditorData } from "./use-jira-editor-data";

// Kaneo label -> Jira component, added to the components of a task that has
// the label.
export function MappingLabelsSection({
  config,
  parent,
  data,
  readOnly,
  issues,
  onChange,
}: {
  config: JiraMappingConfig;
  parent: ResolvedJiraMapping | undefined;
  data: JiraEditorData;
  readOnly: boolean;
  issues: MappingIssue[];
  onChange: (config: JiraMappingConfig) => void;
}) {
  const { t } = useTranslation();
  const rows = labelRows(config, parent);
  const componentOptions = (data.components ?? []).map((component) => ({
    value: component.name,
    label: component.name,
  }));

  const issueText = (index: number): string | null => {
    const issue = issues.find(
      (entry) =>
        entry.list === "labelComponentMappings" && entry.index === index,
    );
    if (!issue) return null;
    if (issue.code === "labelKaneoRequired") {
      return t("settings:jiraIntegration.mapping.errors.labelKaneoRequired");
    }
    if (issue.code === "labelComponentRequired") {
      return t(
        "settings:jiraIntegration.mapping.errors.labelComponentRequired",
      );
    }
    if (issue.code === "labelDuplicate") {
      return t("settings:jiraIntegration.mapping.errors.labelDuplicate");
    }
    return null;
  };

  return (
    <SectionShell
      title={t("settings:jiraIntegration.mapping.labelsTitle")}
      description={t("settings:jiraIntegration.mapping.labelsDescription")}
      actions={
        !readOnly && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              onChange(
                appendRow(config, "labelComponentMappings", {
                  kaneoLabel: "",
                  jiraComponent: "",
                }),
              )
            }
          >
            <Plus />
            {t("settings:jiraIntegration.mapping.addLabel")}
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:jiraIntegration.mapping.labelsEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((entry) => {
            if (entry.kind === "inherited") {
              return (
                <InheritedRow
                  key={`inherited:${entry.key}`}
                  origin={entry.parent.origin}
                  readOnly={readOnly}
                  summary={
                    <span>
                      <span className="font-medium">
                        {entry.parent.kaneoLabel}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {entry.parent.jiraComponent}
                    </span>
                  }
                  onOverride={() =>
                    onChange(overrideLabelRow(config, entry.parent))
                  }
                  onDisable={() =>
                    onChange(disableLabelRow(config, entry.parent))
                  }
                />
              );
            }
            if (entry.kind === "disabled") {
              return (
                <DisabledRow
                  key={`disabled:${entry.index}`}
                  readOnly={readOnly}
                  summary={
                    <span>
                      <span className="font-medium">
                        {entry.own.kaneoLabel}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {entry.parent?.jiraComponent ?? ""}
                    </span>
                  }
                  onRestore={() =>
                    onChange(
                      removeRow(config, "labelComponentMappings", entry.index),
                    )
                  }
                />
              );
            }

            const row = entry.own;
            return (
              <OwnRowFrame
                key={`own:${entry.index}`}
                overrides={entry.overrides?.origin}
                invalid={issueText(entry.index)}
                readOnly={readOnly}
                onRemove={() =>
                  onChange(
                    removeRow(config, "labelComponentMappings", entry.index),
                  )
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.kaneoLabel")}
                    </p>
                    <Input
                      size="sm"
                      value={row.kaneoLabel}
                      disabled={readOnly}
                      aria-invalid={!row.kaneoLabel.trim() || undefined}
                      aria-label={t(
                        "settings:jiraIntegration.mapping.kaneoLabel",
                      )}
                      onChange={(event) =>
                        onChange(
                          updateRow(
                            config,
                            "labelComponentMappings",
                            entry.index,
                            { kaneoLabel: event.target.value },
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.jiraComponent")}
                    </p>
                    {data.components ? (
                      <SimpleSelect
                        value={row.jiraComponent}
                        options={componentOptions}
                        disabled={readOnly}
                        invalid={!row.jiraComponent?.trim()}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.selectPlaceholder",
                        )}
                        ariaLabel={t(
                          "settings:jiraIntegration.mapping.jiraComponent",
                        )}
                        onChange={(name) =>
                          onChange(
                            updateRow(
                              config,
                              "labelComponentMappings",
                              entry.index,
                              { jiraComponent: name },
                            ),
                          )
                        }
                      />
                    ) : (
                      <Input
                        size="sm"
                        value={row.jiraComponent ?? ""}
                        disabled={readOnly}
                        aria-invalid={!row.jiraComponent?.trim() || undefined}
                        aria-label={t(
                          "settings:jiraIntegration.mapping.jiraComponent",
                        )}
                        onChange={(event) =>
                          onChange(
                            updateRow(
                              config,
                              "labelComponentMappings",
                              entry.index,
                              { jiraComponent: event.target.value },
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              </OwnRowFrame>
            );
          })}
        </ul>
      )}
    </SectionShell>
  );
}
