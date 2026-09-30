import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  JiraMappingConfig,
  JiraStatusMapping,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { SimpleSelect } from "./mapping-controls";
import {
  appendRow,
  disableStatusRow,
  type MappingIssue,
  overrideStatusRow,
  removeRow,
  statusRows,
  updateRow,
} from "./mapping-model";
import {
  DisabledRow,
  InheritedRow,
  OwnRowFrame,
  SectionShell,
} from "./mapping-row";
import type { JiraEditorData } from "./use-jira-editor-data";

// Jira status -> Kaneo status. Hidden at the user level: a status proposal
// belongs to the task, not to a person.
export function MappingStatusesSection({
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
  const rows = statusRows(config, parent);

  const kaneoName = (slug: string | null) =>
    data.columns?.find((column) => column.slug === slug)?.name ?? slug ?? "";

  const issueText = (index: number): string | null => {
    const issue = issues.find(
      (entry) => entry.list === "statusMappings" && entry.index === index,
    );
    if (!issue) return null;
    if (issue.code === "statusJiraRequired") {
      return t("settings:jiraIntegration.mapping.errors.statusJiraRequired");
    }
    if (issue.code === "statusKaneoRequired") {
      return t("settings:jiraIntegration.mapping.errors.statusKaneoRequired");
    }
    if (issue.code === "statusDuplicate") {
      return t("settings:jiraIntegration.mapping.errors.statusDuplicate");
    }
    return null;
  };

  const statusOptions = (data.statuses ?? []).map((status) => ({
    value: status.id,
    label: status.name,
  }));
  const columnOptions = (data.columns ?? []).map((column) => ({
    value: column.slug,
    label: column.name,
  }));

  return (
    <SectionShell
      title={t("settings:jiraIntegration.mapping.statusesTitle")}
      description={
        data.level === "project"
          ? t("settings:jiraIntegration.mapping.statusesDescriptionProject")
          : t("settings:jiraIntegration.mapping.statusesDescriptionWorkspace")
      }
      actions={
        !readOnly && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              onChange(
                appendRow(config, "statusMappings", {
                  jiraStatusName: "",
                  kaneoStatus: "",
                }),
              )
            }
          >
            <Plus />
            {t("settings:jiraIntegration.mapping.addStatus")}
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:jiraIntegration.mapping.statusesEmpty")}
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
                        {entry.parent.jiraStatusName}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {kaneoName(entry.parent.kaneoStatus)}
                    </span>
                  }
                  onOverride={() =>
                    onChange(overrideStatusRow(config, entry.parent))
                  }
                  onDisable={() =>
                    onChange(disableStatusRow(config, entry.parent))
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
                        {entry.own.jiraStatusName}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {kaneoName(entry.parent?.kaneoStatus ?? null)}
                    </span>
                  }
                  onRestore={() =>
                    onChange(removeRow(config, "statusMappings", entry.index))
                  }
                />
              );
            }

            const row: JiraStatusMapping = entry.own;
            return (
              <OwnRowFrame
                key={`own:${entry.index}`}
                overrides={entry.overrides?.origin}
                invalid={issueText(entry.index)}
                readOnly={readOnly}
                onRemove={() =>
                  onChange(removeRow(config, "statusMappings", entry.index))
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.jiraStatus")}
                    </p>
                    {data.statuses ? (
                      <SimpleSelect
                        value={row.jiraStatusId ?? ""}
                        options={statusOptions}
                        disabled={readOnly}
                        invalid={!row.jiraStatusName.trim()}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.selectPlaceholder",
                        )}
                        ariaLabel={t(
                          "settings:jiraIntegration.mapping.jiraStatus",
                        )}
                        onChange={(id) =>
                          onChange(
                            updateRow(config, "statusMappings", entry.index, {
                              jiraStatusId: id,
                              jiraStatusName:
                                data.statuses?.find(
                                  (status) => status.id === id,
                                )?.name ?? row.jiraStatusName,
                            }),
                          )
                        }
                      />
                    ) : (
                      <Input
                        size="sm"
                        value={row.jiraStatusName}
                        disabled={readOnly}
                        aria-invalid={!row.jiraStatusName.trim() || undefined}
                        aria-label={t(
                          "settings:jiraIntegration.mapping.jiraStatusName",
                        )}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.jiraStatusNamePlaceholder",
                        )}
                        onChange={(event) =>
                          onChange(
                            updateRow(config, "statusMappings", entry.index, {
                              jiraStatusName: event.target.value,
                              // A typed name no longer matches a picked id.
                              jiraStatusId: undefined,
                            }),
                          )
                        }
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.kaneoStatus")}
                    </p>
                    {data.columns ? (
                      <SimpleSelect
                        value={row.kaneoStatus}
                        options={columnOptions}
                        disabled={readOnly}
                        invalid={!row.kaneoStatus?.trim()}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.selectPlaceholder",
                        )}
                        ariaLabel={t(
                          "settings:jiraIntegration.mapping.kaneoStatus",
                        )}
                        onChange={(slug) =>
                          onChange(
                            updateRow(config, "statusMappings", entry.index, {
                              kaneoStatus: slug,
                            }),
                          )
                        }
                      />
                    ) : (
                      <Input
                        size="sm"
                        value={row.kaneoStatus ?? ""}
                        disabled={readOnly}
                        aria-invalid={!row.kaneoStatus?.trim() || undefined}
                        aria-label={t(
                          "settings:jiraIntegration.mapping.kaneoStatus",
                        )}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.kaneoStatusPlaceholder",
                        )}
                        onChange={(event) =>
                          onChange(
                            updateRow(config, "statusMappings", entry.index, {
                              kaneoStatus: event.target.value,
                            }),
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
