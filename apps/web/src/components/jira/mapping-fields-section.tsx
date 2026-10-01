import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  JiraFieldMapping,
  JiraFieldSource,
  JiraFieldType,
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { SimpleSelect, TagListInput, ValueMapEditor } from "./mapping-controls";
import {
  appendRow,
  BUILTIN_SOURCES,
  type BuiltinSource,
  coerceDefaultValue,
  defaultValueToList,
  defaultValueToText,
  disableFieldRow,
  emptyFieldMapping,
  fieldRows,
  inferJiraFieldType,
  JIRA_FIELD_TYPES,
  type MappingIssue,
  MULTI_VALUE_TYPES,
  overrideFieldRow,
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

function encodeSource(source: JiraFieldSource): string {
  if (source.kind === "builtin") return `builtin:${source.field}`;
  if (source.kind === "custom") return `custom:${source.customFieldId}`;
  return "none";
}

function decodeSource(value: string): JiraFieldSource {
  if (value.startsWith("builtin:")) {
    return {
      kind: "builtin",
      field: value.slice("builtin:".length) as BuiltinSource,
    };
  }
  if (value.startsWith("custom:")) {
    return { kind: "custom", customFieldId: value.slice("custom:".length) };
  }
  return { kind: "none" };
}

// Static keys, so the translation checker sees every string.
export function useBuiltinLabels() {
  const { t } = useTranslation();
  return {
    title: t("settings:jiraIntegration.mapping.builtin.title"),
    description: t("settings:jiraIntegration.mapping.builtin.description"),
    priority: t("settings:jiraIntegration.mapping.builtin.priority"),
    status: t("settings:jiraIntegration.mapping.builtin.status"),
    dueDate: t("settings:jiraIntegration.mapping.builtin.dueDate"),
    startDate: t("settings:jiraIntegration.mapping.builtin.startDate"),
    labels: t("settings:jiraIntegration.mapping.builtin.labels"),
    assignee: t("settings:jiraIntegration.mapping.builtin.assignee"),
    progress: t("settings:jiraIntegration.mapping.builtin.progress"),
  } satisfies Record<BuiltinSource, string>;
}

function useFieldTypeLabels() {
  const { t } = useTranslation();
  return {
    string: t("settings:jiraIntegration.mapping.fieldType.string"),
    text: t("settings:jiraIntegration.mapping.fieldType.text"),
    number: t("settings:jiraIntegration.mapping.fieldType.number"),
    date: t("settings:jiraIntegration.mapping.fieldType.date"),
    datetime: t("settings:jiraIntegration.mapping.fieldType.datetime"),
    option: t("settings:jiraIntegration.mapping.fieldType.option"),
    options: t("settings:jiraIntegration.mapping.fieldType.options"),
    labels: t("settings:jiraIntegration.mapping.fieldType.labels"),
    components: t("settings:jiraIntegration.mapping.fieldType.components"),
    priority: t("settings:jiraIntegration.mapping.fieldType.priority"),
    user: t("settings:jiraIntegration.mapping.fieldType.user"),
    users: t("settings:jiraIntegration.mapping.fieldType.users"),
  } satisfies Record<JiraFieldType, string>;
}

export function MappingFieldsSection({
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
  const builtinLabels = useBuiltinLabels();
  const typeLabels = useFieldTypeLabels();
  const rows = fieldRows(config, parent);
  // The value map keeps its rows in local state, so rows that shift position
  // after a removal remount.
  const [version, setVersion] = useState(0);

  const sourceLabel = (source: JiraFieldSource) => {
    if (source.kind === "builtin") return builtinLabels[source.field];
    if (source.kind === "custom") {
      return (
        data.customFields.find((field) => field.id === source.customFieldId)
          ?.name ?? source.customFieldId
      );
    }
    return t("settings:jiraIntegration.mapping.sourceNone");
  };

  const sourceOptions = [
    ...BUILTIN_SOURCES.map((field) => ({
      value: `builtin:${field}`,
      label: builtinLabels[field],
    })),
    ...data.customFields.map((field) => ({
      value: `custom:${field.id}`,
      label: t("settings:jiraIntegration.mapping.customFieldOption", {
        name: field.name,
      }),
    })),
    {
      value: "none",
      label: t("settings:jiraIntegration.mapping.sourceNone"),
    },
  ];

  const fieldIssue = (index: number): string | null => {
    const issue = issues.find(
      (entry) => entry.list === "fieldMappings" && entry.index === index,
    );
    if (!issue) return null;
    if (issue.code === "fieldTargetRequired") {
      return t("settings:jiraIntegration.mapping.errors.fieldTargetRequired");
    }
    if (issue.code === "fieldDuplicate") {
      return t("settings:jiraIntegration.mapping.errors.fieldDuplicate");
    }
    if (issue.code === "fieldNumberInvalid") {
      return t("settings:jiraIntegration.mapping.errors.fieldNumberInvalid");
    }
    return null;
  };

  const patchRow = (index: number, patch: Partial<JiraFieldMapping>) =>
    onChange(updateRow(config, "fieldMappings", index, patch));

  const summary = (row: JiraFieldMapping) => (
    <span>
      <span className="font-medium">
        {row.target.fieldName || row.target.fieldId}
      </span>{" "}
      <span className="text-muted-foreground">
        {t("settings:jiraIntegration.mapping.fieldSummary", {
          source: sourceLabel(row.source),
        })}
      </span>
    </span>
  );

  return (
    <SectionShell
      title={t("settings:jiraIntegration.mapping.fieldsTitle")}
      description={t("settings:jiraIntegration.mapping.fieldsDescription")}
      actions={
        !readOnly && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              onChange(appendRow(config, "fieldMappings", emptyFieldMapping()))
            }
          >
            <Plus />
            {t("settings:jiraIntegration.mapping.addField")}
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:jiraIntegration.mapping.fieldsEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((entry) => {
            if (entry.kind === "inherited") {
              return (
                <InheritedRow
                  key={`inherited:${entry.key}`}
                  origin={entry.parent.origin}
                  summary={summary(entry.parent)}
                  readOnly={readOnly}
                  onOverride={() =>
                    onChange(overrideFieldRow(config, entry.parent))
                  }
                  onDisable={() =>
                    onChange(disableFieldRow(config, entry.parent))
                  }
                />
              );
            }
            if (entry.kind === "disabled") {
              return (
                <DisabledRow
                  key={`disabled:${entry.index}`}
                  summary={summary({
                    ...entry.own,
                    source: entry.parent?.source ?? entry.own.source,
                  })}
                  readOnly={readOnly}
                  onRestore={() => {
                    setVersion((current) => current + 1);
                    onChange(removeRow(config, "fieldMappings", entry.index));
                  }}
                />
              );
            }

            const row = entry.own;
            const multi = MULTI_VALUE_TYPES.has(row.target.type);
            const fieldOptions = (data.fields ?? []).map((field) => ({
              value: field.fieldId,
              label: `${field.name} (${field.fieldId})`,
            }));

            return (
              <OwnRowFrame
                key={`own:${entry.index}:${version}`}
                overrides={entry.overrides?.origin}
                invalid={fieldIssue(entry.index)}
                readOnly={readOnly}
                onRemove={() => {
                  setVersion((current) => current + 1);
                  onChange(removeRow(config, "fieldMappings", entry.index));
                }}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.kaneoSource")}
                    </p>
                    <SimpleSelect
                      value={encodeSource(row.source)}
                      options={sourceOptions}
                      disabled={readOnly}
                      placeholder={t(
                        "settings:jiraIntegration.mapping.selectPlaceholder",
                      )}
                      ariaLabel={t(
                        "settings:jiraIntegration.mapping.kaneoSource",
                      )}
                      onChange={(value) =>
                        patchRow(entry.index, { source: decodeSource(value) })
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.jiraField")}
                    </p>
                    {data.fields ? (
                      <SimpleSelect
                        value={row.target.fieldId}
                        options={fieldOptions}
                        disabled={readOnly}
                        invalid={!row.target.fieldId.trim()}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.selectPlaceholder",
                        )}
                        ariaLabel={t(
                          "settings:jiraIntegration.mapping.jiraField",
                        )}
                        onChange={(fieldId) => {
                          const meta = data.fields?.find(
                            (field) => field.fieldId === fieldId,
                          );
                          const type = meta
                            ? inferJiraFieldType(meta)
                            : row.target.type;
                          patchRow(entry.index, {
                            target: {
                              fieldId,
                              ...(meta ? { fieldName: meta.name } : {}),
                              type,
                            },
                            defaultValue: coerceDefaultValue(
                              row.defaultValue,
                              type,
                            ),
                          });
                        }}
                      />
                    ) : (
                      <Input
                        size="sm"
                        value={row.target.fieldId}
                        disabled={readOnly}
                        aria-invalid={!row.target.fieldId.trim() || undefined}
                        aria-label={t(
                          "settings:jiraIntegration.mapping.jiraFieldId",
                        )}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.jiraFieldIdPlaceholder",
                        )}
                        onChange={(event) =>
                          patchRow(entry.index, {
                            target: {
                              ...row.target,
                              fieldId: event.target.value,
                            },
                          })
                        }
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.jiraFieldType")}
                    </p>
                    <SimpleSelect
                      value={row.target.type}
                      options={JIRA_FIELD_TYPES.map((type) => ({
                        value: type,
                        label: typeLabels[type],
                      }))}
                      disabled={readOnly}
                      placeholder={t(
                        "settings:jiraIntegration.mapping.selectPlaceholder",
                      )}
                      ariaLabel={t(
                        "settings:jiraIntegration.mapping.jiraFieldType",
                      )}
                      onChange={(value) => {
                        const type = value as JiraFieldType;
                        patchRow(entry.index, {
                          target: { ...row.target, type },
                          defaultValue: coerceDefaultValue(
                            row.defaultValue,
                            type,
                          ),
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.defaultValue")}
                    </p>
                    {multi ? (
                      <TagListInput
                        value={defaultValueToList(row.defaultValue)}
                        disabled={readOnly}
                        ariaLabel={t(
                          "settings:jiraIntegration.mapping.defaultValue",
                        )}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.defaultValueListHint",
                        )}
                        onChange={(list) =>
                          patchRow(entry.index, {
                            defaultValue: list.length > 0 ? list : undefined,
                          })
                        }
                      />
                    ) : (
                      <Input
                        size="sm"
                        value={defaultValueToText(row.defaultValue)}
                        disabled={readOnly}
                        aria-label={t(
                          "settings:jiraIntegration.mapping.defaultValue",
                        )}
                        placeholder={t(
                          "settings:jiraIntegration.mapping.defaultValueHint",
                        )}
                        onChange={(event) =>
                          patchRow(entry.index, {
                            defaultValue: event.target.value,
                          })
                        }
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("settings:jiraIntegration.mapping.valueMap")}
                    </p>
                    <ValueMapEditor
                      value={row.valueMap ?? {}}
                      disabled={readOnly}
                      onChange={(valueMap) =>
                        patchRow(entry.index, { valueMap })
                      }
                    />
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
